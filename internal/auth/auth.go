package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type Config struct {
	DB         *sql.DB
	SessionTTL string

	// InitialPassword is the password used for the first-run admin user.
	// If empty, a 16-char random password is generated and printed to PasswordOutput.
	// Tests typically pass a fixed value (e.g. "admin") to make assertions deterministic.
	InitialPassword string

	// PasswordOutput receives the generated initial password when InitialPassword
	// is empty. Defaults to os.Stdout (operators read it from `docker logs hearth`).
	// Tests inject an *bytes.Buffer to capture and assert the value.
	PasswordOutput io.Writer
}

// loginAttempt tracks failed login attempts for rate limiting.
type loginAttempt struct {
	count     int
	lastTry   time.Time
	blockedAt time.Time
}

type Service struct {
	db         *sql.DB
	sessionTTL time.Duration

	// Rate limiting for login attempts (in-memory, resets on restart).
	rateMu        sync.Mutex
	loginAttempts map[string]*loginAttempt

	stopCh chan struct{} // signals background goroutines to stop
}

func New(cfg Config) (*Service, error) {
	if cfg.DB == nil {
		return nil, errors.New("db is required")
	}
	ttl, err := time.ParseDuration(cfg.SessionTTL)
	if err != nil {
		return nil, err
	}
	s := &Service{
		db:            cfg.DB,
		sessionTTL:    ttl,
		loginAttempts: make(map[string]*loginAttempt),
		stopCh:        make(chan struct{}),
	}
	output := cfg.PasswordOutput
	if output == nil {
		output = os.Stdout
	}
	if err := s.ensureDefaultAdmin(cfg.InitialPassword, output); err != nil {
		return nil, err
	}
	go s.sessionCleanupLoop()
	return s, nil
}

// Stop signals background goroutines to exit.
func (s *Service) Stop() {
	select {
	case <-s.stopCh:
	default:
		close(s.stopCh)
	}
}

// sessionCleanupLoop periodically removes expired sessions from the database.
func (s *Service) sessionCleanupLoop() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.cleanupExpiredSessions()
			s.cleanupExpiredLoginAttempts()
		}
	}
}

func (s *Service) cleanupExpiredSessions() {
	now := time.Now().Unix()
	result, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, now)
	if err != nil {
		slog.Warn("failed to cleanup expired sessions", "error", err)
		return
	}
	if n, _ := result.RowsAffected(); n > 0 {
		slog.Info("cleaned up expired sessions", "count", n)
	}
}

func (s *Service) cleanupExpiredLoginAttempts() {
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	now := time.Now()
	for username, attempt := range s.loginAttempts {
		expired := false
		if !attempt.blockedAt.IsZero() && now.After(attempt.blockedAt.Add(loginBlockDuration)) {
			expired = true
		} else if attempt.blockedAt.IsZero() && now.After(attempt.lastTry.Add(attemptWindow)) {
			expired = true
		}
		if expired {
			delete(s.loginAttempts, username)
		}
	}
}

// ensureDefaultAdmin creates the initial "admin" user when no users exist yet.
//
// Password sourcing:
//   - If initialPassword is non-empty (e.g. set via HEARTH_INITIAL_PASSWORD or
//     supplied by tests), that value is used and the user is NOT flagged for
//     forced change.
//   - Otherwise a 16-char random password is generated and printed to output as
//     a banner. Operators reach it via `docker logs hearth` (no file ever
//     touches disk). The user is flagged with must_change_password=1; the
//     server enforces a password change before any other admin action.
//
// The generated password is intentionally never sent through the slog pipeline
// (which may be aggregated into Loki/ELK). It only goes to the dedicated writer.
func (s *Service) ensureDefaultAdmin(initialPassword string, output io.Writer) error {
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM users`).Scan(&cnt); err != nil {
		return err
	}
	if cnt > 0 {
		return nil
	}

	password := initialPassword
	mustChange := 0
	source := "HEARTH_INITIAL_PASSWORD"

	if password == "" {
		generated, err := generateRandomPassword(16)
		if err != nil {
			return fmt.Errorf("generate initial password: %w", err)
		}
		password = generated
		mustChange = 1
		source = "generated"
		printGeneratedPassword(output, generated)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	_, err = s.db.Exec(
		`INSERT INTO users (id, username, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, ?)`,
		uuid.NewString(), "admin", string(hash), mustChange, now,
	)
	if err != nil {
		return err
	}
	slog.Info("created default admin user", "username", "admin", "password_source", source, "must_change", mustChange == 1)
	return nil
}

// printGeneratedPassword renders a deliberately loud banner so it's hard to miss
// when scrolling `docker logs hearth`. Format is human-oriented; tests parse the
// `password:` line.
func printGeneratedPassword(w io.Writer, pw string) {
	const bar = "════════════════════════════════════════════════════════════"
	fmt.Fprintln(w)
	fmt.Fprintln(w, bar)
	fmt.Fprintln(w, "  HEARTH — initial admin credentials (record this now)")
	fmt.Fprintln(w, bar)
	fmt.Fprintln(w, "    username: admin")
	fmt.Fprintln(w, "    password:", pw)
	fmt.Fprintln(w)
	fmt.Fprintln(w, "  Use this password for first login. You will be required")
	fmt.Fprintln(w, "  to change it before any other action. It is NOT logged")
	fmt.Fprintln(w, "  again and is NOT written to disk.")
	fmt.Fprintln(w, bar)
	fmt.Fprintln(w)
}

// passwordAlphabet excludes look-alike characters (0/O, 1/l/I) so an operator
// can transcribe the generated password from a NAS console without errors.
const passwordAlphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func generateRandomPassword(n int) (string, error) {
	max := big.NewInt(int64(len(passwordAlphabet)))
	out := make([]byte, n)
	for i := range out {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = passwordAlphabet[idx.Int64()]
	}
	return string(out), nil
}

// MustChangePassword reports whether the user is required to change their password
// before performing any other admin action. Returns false (and nil) for unknown users
// to avoid leaking existence; the caller is expected to have already validated the session.
func (s *Service) MustChangePassword(userID string) (bool, error) {
	var v int
	err := s.db.QueryRow(`SELECT must_change_password FROM users WHERE id = ?`, userID).Scan(&v)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return v == 1, nil
}

// Rate limiting constants.
const (
	maxLoginAttempts   = 5                // Max failed attempts before blocking.
	loginBlockDuration = 5 * time.Minute  // How long to block after max attempts.
	attemptWindow      = 15 * time.Minute // Window to count failed attempts.
)

// ErrTooManyAttempts is returned when login rate limit is exceeded.
var ErrTooManyAttempts = errors.New("too many login attempts, please try again later")

// checkRateLimit checks if the username is rate-limited.
// Returns error if blocked, nil otherwise.
func (s *Service) checkRateLimit(username string) error {
	s.rateMu.Lock()
	defer s.rateMu.Unlock()

	attempt, exists := s.loginAttempts[username]
	if !exists {
		return nil
	}

	now := time.Now()

	// If blocked and block duration hasn't passed.
	if !attempt.blockedAt.IsZero() && now.Before(attempt.blockedAt.Add(loginBlockDuration)) {
		return ErrTooManyAttempts
	}

	// If block expired, reset.
	if !attempt.blockedAt.IsZero() && now.After(attempt.blockedAt.Add(loginBlockDuration)) {
		delete(s.loginAttempts, username)
		return nil
	}

	// If last attempt was outside the window, reset.
	if now.After(attempt.lastTry.Add(attemptWindow)) {
		delete(s.loginAttempts, username)
		return nil
	}

	return nil
}

// recordFailedLogin records a failed login attempt.
func (s *Service) recordFailedLogin(username string) {
	s.rateMu.Lock()
	defer s.rateMu.Unlock()

	now := time.Now()
	attempt, exists := s.loginAttempts[username]
	if !exists {
		s.loginAttempts[username] = &loginAttempt{count: 1, lastTry: now}
		return
	}

	// If last attempt was outside the window, reset counter.
	if now.After(attempt.lastTry.Add(attemptWindow)) {
		attempt.count = 1
		attempt.lastTry = now
		attempt.blockedAt = time.Time{}
		return
	}

	attempt.count++
	attempt.lastTry = now

	// Block if exceeded max attempts.
	if attempt.count >= maxLoginAttempts {
		attempt.blockedAt = now
		slog.Warn("login rate limit exceeded", "username", username, "attempts", attempt.count)
	}
}

// clearLoginAttempts clears failed attempts after successful login.
func (s *Service) clearLoginAttempts(username string) {
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	delete(s.loginAttempts, username)
}

func (s *Service) Login(username, password string) (string, error) {
	// Check rate limit first.
	if err := s.checkRateLimit(username); err != nil {
		return "", err
	}

	var userID string
	var passwordHash string
	if err := s.db.QueryRow(`SELECT id, password_hash FROM users WHERE username = ?`, username).Scan(&userID, &passwordHash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			s.recordFailedLogin(username)
			return "", errors.New("invalid credentials")
		}
		return "", err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		s.recordFailedLogin(username)
		return "", errors.New("invalid credentials")
	}

	// Clear failed attempts on successful login.
	s.clearLoginAttempts(username)

	token, err := newToken(32)
	if err != nil {
		return "", err
	}

	now := time.Now()
	exp := now.Add(s.sessionTTL).Unix()
	_, err = s.db.Exec(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`, token, userID, exp, now.Unix())
	if err != nil {
		return "", err
	}

	slog.Info("user logged in", "username", username)
	return token, nil
}

func (s *Service) Logout(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
	return err
}

func (s *Service) Validate(token string) (string, error) {
	var userID string
	var expiresAt int64
	if err := s.db.QueryRow(`SELECT user_id, expires_at FROM sessions WHERE token = ?`, token).Scan(&userID, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("unauthorized")
		}
		return "", err
	}
	if time.Now().Unix() > expiresAt {
		_, _ = s.db.Exec(`DELETE FROM sessions WHERE token = ?`, token)
		return "", errors.New("unauthorized")
	}
	return userID, nil
}

// SessionTTL returns the configured session TTL duration.
func (s *Service) SessionTTL() time.Duration {
	return s.sessionTTL
}

func newToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// UsernameByID looks up a username by user ID.
func (s *Service) UsernameByID(userID string) (string, error) {
	var username string
	err := s.db.QueryRow(`SELECT username FROM users WHERE id = ?`, userID).Scan(&username)
	return username, err
}

// --------------------------------------------------------------------------- //
// ChangePassword changes a user's password after verifying the old password.
func (s *Service) ChangePassword(userID string, oldPassword, newPassword string) error {
	if newPassword == "" {
		return errors.New("new password cannot be empty")
	}
	if len(newPassword) < 4 {
		return errors.New("password must be at least 4 characters")
	}

	var storedHash string
	err := s.db.QueryRow(`SELECT password_hash FROM users WHERE id = ?`, userID).Scan(&storedHash)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return errors.New("user not found")
		}
		return fmt.Errorf("failed to query user: %w", err)
	}

	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(oldPassword)); err != nil {
		return errors.New("incorrect old password")
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = s.db.Exec(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`, string(newHash), userID)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	slog.Info("password changed", "user_id", userID)
	return nil
}

// --------------------------------------------------------------------------- //
// ResetPassword resets a user's password without requiring the old password.
// This is meant for administrative use (e.g., reset script).
func (s *Service) ResetPassword(username, newPassword string) error {
	if newPassword == "" {
		return errors.New("new password cannot be empty")
	}
	if len(newPassword) < 4 {
		return errors.New("password must be at least 4 characters")
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	result, err := s.db.Exec(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = ?`, string(newHash), username)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return errors.New("user not found")
	}

	slog.Info("password reset", "username", username)
	return nil
}

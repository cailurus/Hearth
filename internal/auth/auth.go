package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type Config struct {
	DB         *sql.DB
	SessionTTL string
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
	rateMu       sync.Mutex
	loginAttemps map[string]*loginAttempt
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
		db:           cfg.DB,
		sessionTTL:   ttl,
		loginAttemps: make(map[string]*loginAttempt),
	}
	if err := s.ensureDefaultAdmin(); err != nil {
		return nil, err
	}
	return s, nil
}

// Default admin credentials:
// username: admin
// password: admin
// (You should change it after first login.)
func (s *Service) ensureDefaultAdmin() error {
	var cnt int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM users`).Scan(&cnt); err != nil {
		return err
	}
	if cnt > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	now := time.Now().Unix()
	_, err = s.db.Exec(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`,
		uuid.NewString(), "admin", string(hash), now,
	)
	slog.Info("created default admin user", "username", "admin")
	return err
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

	attempt, exists := s.loginAttemps[username]
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
		delete(s.loginAttemps, username)
		return nil
	}

	// If last attempt was outside the window, reset.
	if now.After(attempt.lastTry.Add(attemptWindow)) {
		delete(s.loginAttemps, username)
		return nil
	}

	return nil
}

// recordFailedLogin records a failed login attempt.
func (s *Service) recordFailedLogin(username string) {
	s.rateMu.Lock()
	defer s.rateMu.Unlock()

	now := time.Now()
	attempt, exists := s.loginAttemps[username]
	if !exists {
		s.loginAttemps[username] = &loginAttempt{count: 1, lastTry: now}
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
	delete(s.loginAttemps, username)
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

func newToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
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

	_, err = s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(newHash), userID)
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

	result, err := s.db.Exec(`UPDATE users SET password_hash = ? WHERE username = ?`, string(newHash), username)
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

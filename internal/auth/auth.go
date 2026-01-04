package auth

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type Config struct {
	DB         *sql.DB
	SessionTTL string
}

type Service struct {
	db         *sql.DB
	sessionTTL time.Duration
}

func New(cfg Config) (*Service, error) {
	if cfg.DB == nil {
		return nil, errors.New("db is required")
	}
	ttl, err := time.ParseDuration(cfg.SessionTTL)
	if err != nil {
		return nil, err
	}
	s := &Service{db: cfg.DB, sessionTTL: ttl}
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
	return err
}

func (s *Service) Login(username, password string) (string, error) {
	var userID string
	var passwordHash string
	if err := s.db.QueryRow(`SELECT id, password_hash FROM users WHERE username = ?`, username).Scan(&userID, &passwordHash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("invalid credentials")
		}
		return "", err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(password)); err != nil {
		return "", errors.New("invalid credentials")
	}

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

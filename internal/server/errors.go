package server

import (
	"errors"
	"net/http"
)

// AppError represents an application error with HTTP status code.
type AppError struct {
	Code    int    // HTTP status code
	Message string // User-facing message
	Err     error  // Internal error (not exposed to client)
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Message
}

func (e *AppError) Unwrap() error {
	return e.Err
}

// Common error constructors
func ErrBadRequest(msg string) *AppError {
	return &AppError{Code: http.StatusBadRequest, Message: msg}
}

func ErrUnauthorized(msg string) *AppError {
	return &AppError{Code: http.StatusUnauthorized, Message: msg}
}

func ErrForbidden(msg string) *AppError {
	return &AppError{Code: http.StatusForbidden, Message: msg}
}

func ErrNotFound(msg string) *AppError {
	return &AppError{Code: http.StatusNotFound, Message: msg}
}

func ErrInternal(msg string, err error) *AppError {
	return &AppError{Code: http.StatusInternalServerError, Message: msg, Err: err}
}

func ErrServiceUnavailable(msg string, err error) *AppError {
	return &AppError{Code: http.StatusServiceUnavailable, Message: msg, Err: err}
}

// handleError writes an appropriate error response based on error type.
func handleError(w http.ResponseWriter, err error) {
	var appErr *AppError
	if errors.As(err, &appErr) {
		writeError(w, appErr.Code, appErr.Message)
		return
	}

	// Default to internal server error for unknown errors
	writeError(w, http.StatusInternalServerError, "internal server error")
}

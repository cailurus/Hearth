// Package main provides a CLI tool to reset the admin password.
// Usage: go run cmd/reset-password/main.go -db data/hearth.db -password newpassword
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"

	_ "modernc.org/sqlite"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	dbPath := flag.String("db", "data/hearth.db", "path to SQLite database")
	username := flag.String("user", "admin", "username to reset")
	password := flag.String("password", "", "new password (required)")
	flag.Parse()

	if *password == "" {
		fmt.Fprintln(os.Stderr, "Error: -password is required")
		flag.Usage()
		os.Exit(1)
	}

	if len(*password) < 4 {
		fmt.Fprintln(os.Stderr, "Error: password must be at least 4 characters")
		os.Exit(1)
	}

	db, err := sql.Open("sqlite", *dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	hash, err := bcrypt.GenerateFromPassword([]byte(*password), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error hashing password: %v\n", err)
		os.Exit(1)
	}

	result, err := db.Exec(`UPDATE users SET password_hash = ? WHERE username = ?`, string(hash), *username)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error updating password: %v\n", err)
		os.Exit(1)
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		fmt.Fprintf(os.Stderr, "Error: user '%s' not found\n", *username)
		os.Exit(1)
	}

	fmt.Printf("Password for user '%s' has been reset successfully.\n", *username)
}

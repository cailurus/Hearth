package server

import (
	"errors"
	"net"
	"syscall"
	"testing"
)

// TestClassifyProbeError covers the rule-of-thumb mapping from probe failure
// to status: server-side "I can't see it" → unknown (gray), upstream
// "rejected my request" → down (red).
func TestClassifyProbeError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"nil → up", nil, "up"},
		{"host unreachable → unknown", syscall.EHOSTUNREACH, "unknown"},
		{"network unreachable → unknown", syscall.ENETUNREACH, "unknown"},
		{"wrapped EHOSTUNREACH → unknown",
			&net.OpError{Op: "dial", Err: syscall.EHOSTUNREACH}, "unknown"},
		{"DNS error → unknown", &net.DNSError{Err: "no such host"}, "unknown"},
		{"connection refused → down", syscall.ECONNREFUSED, "down"},
		{"generic error → down", errors.New("boom"), "down"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := classifyProbeError(c.err)
			if got != c.want {
				t.Errorf("classifyProbeError(%v): want %q, got %q", c.err, c.want, got)
			}
		})
	}
}

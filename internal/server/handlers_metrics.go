package server

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/morezhou/hearth/internal/metrics"
)

func (s *Server) handleGetHostMetrics(w http.ResponseWriter, r *http.Request) {
	m, err := metrics.Collect(r.Context())
	if err != nil {
		// gopsutil's Collect can return partial data with an error indicating
		// which sub-collector (cpu/disk/net) failed; the caller still gets a
		// useful response, so we log and continue.
		slog.Warn("metrics collect partial", "error", err)
	}
	writeJSON(w, http.StatusOK, m)
}

type metricsHistoryRow struct {
	ts           int64
	cpuPercent   float64
	memPercent   float64
	diskPercent  float64
	netBytesSent int64
	netBytesRecv int64
}

type metricsHistoryPoint struct {
	Ts          int64   `json:"ts"`
	CPUPercent  float64 `json:"cpuPercent"`
	MemPercent  float64 `json:"memPercent"`
	DiskPercent float64 `json:"diskPercent"`
	NetSendRate float64 `json:"netSendRate"`
	NetRecvRate float64 `json:"netRecvRate"`
}

func (s *Server) handleGetMetricsHistory(w http.ResponseWriter, r *http.Request) {
	period := strings.TrimSpace(r.URL.Query().Get("period"))
	if period == "" {
		period = "24h"
	}

	var dur time.Duration
	var maxPoints int
	switch period {
	case "1h":
		dur = 1 * time.Hour
		maxPoints = 120
	case "6h":
		dur = 6 * time.Hour
		maxPoints = 120
	case "24h":
		dur = 24 * time.Hour
		maxPoints = 120
	case "7d":
		dur = 7 * 24 * time.Hour
		maxPoints = 168
	default:
		dur = 24 * time.Hour
		maxPoints = 120
		period = "24h"
	}

	cutoff := time.Now().Add(-dur).UnixMilli()
	rows, err := s.db.QueryContext(r.Context(),
		`SELECT ts, cpu_percent, mem_percent, disk_percent, net_bytes_sent, net_bytes_recv
		 FROM metrics_history WHERE ts >= ? ORDER BY ts ASC`, cutoff)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	var raw []metricsHistoryRow
	for rows.Next() {
		var row metricsHistoryRow
		if err := rows.Scan(&row.ts, &row.cpuPercent, &row.memPercent, &row.diskPercent, &row.netBytesSent, &row.netBytesRecv); err != nil {
			continue
		}
		raw = append(raw, row)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Downsample if needed.
	sampled := downsampleMetrics(raw, maxPoints)

	// Compute network rates from consecutive points.
	points := make([]metricsHistoryPoint, len(sampled))
	for i, s := range sampled {
		points[i] = metricsHistoryPoint{
			Ts:          s.ts,
			CPUPercent:  s.cpuPercent,
			MemPercent:  s.memPercent,
			DiskPercent: s.diskPercent,
		}
		if i > 0 {
			prev := sampled[i-1]
			dtSec := float64(s.ts-prev.ts) / 1000.0
			if dtSec > 0 {
				sentDiff := s.netBytesSent - prev.netBytesSent
				recvDiff := s.netBytesRecv - prev.netBytesRecv
				if sentDiff >= 0 {
					points[i].NetSendRate = float64(sentDiff) / dtSec
				}
				if recvDiff >= 0 {
					points[i].NetRecvRate = float64(recvDiff) / dtSec
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"period": period,
		"points": points,
	})
}

func downsampleMetrics(rows []metricsHistoryRow, maxPoints int) []metricsHistoryRow {
	if len(rows) <= maxPoints {
		return rows
	}
	bucketSize := len(rows) / maxPoints
	if bucketSize < 1 {
		bucketSize = 1
	}
	out := make([]metricsHistoryRow, 0, maxPoints)
	for i := 0; i < len(rows); i += bucketSize {
		end := i + bucketSize
		if end > len(rows) {
			end = len(rows)
		}
		bucket := rows[i:end]
		var sumCPU, sumMem, sumDisk float64
		for _, r := range bucket {
			sumCPU += r.cpuPercent
			sumMem += r.memPercent
			sumDisk += r.diskPercent
		}
		n := float64(len(bucket))
		last := bucket[len(bucket)-1]
		out = append(out, metricsHistoryRow{
			ts:           bucket[len(bucket)/2].ts,
			cpuPercent:   sumCPU / n,
			memPercent:   sumMem / n,
			diskPercent:  sumDisk / n,
			netBytesSent: last.netBytesSent,
			netBytesRecv: last.netBytesRecv,
		})
	}
	return out
}

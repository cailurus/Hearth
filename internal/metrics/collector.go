package metrics

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

// Collector periodically samples host metrics and persists them to SQLite.
type Collector struct {
	db     *sql.DB
	stopCh chan struct{}
}

func NewCollector(db *sql.DB) *Collector {
	return &Collector{db: db, stopCh: make(chan struct{})}
}

func (c *Collector) Start() {
	go c.loop()
}

func (c *Collector) Stop() {
	close(c.stopCh)
}

func (c *Collector) loop() {
	// Collect immediately on startup so the first data point appears quickly.
	c.collect()

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Cleanup once on startup, then every hour.
	c.cleanup()
	cleanupTicker := time.NewTicker(1 * time.Hour)
	defer cleanupTicker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.collect()
		case <-cleanupTicker.C:
			c.cleanup()
		}
	}
}

func (c *Collector) collect() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	m, err := Collect(ctx)
	if err != nil {
		slog.Warn("metrics collector: collect failed", "error", err)
		// Still try to store partial data.
	}

	_, err = c.db.ExecContext(ctx,
		`INSERT INTO metrics_history (ts, cpu_percent, mem_percent, disk_percent, net_bytes_sent, net_bytes_recv)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		m.CollectedAt, m.CPUPercent, m.MemPercent, m.DiskPercent, m.NetBytesSent, m.NetBytesRecv,
	)
	if err != nil {
		slog.Warn("metrics collector: insert failed", "error", err)
	}
}

func (c *Collector) cleanup() {
	cutoff := time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
	_, err := c.db.Exec(`DELETE FROM metrics_history WHERE ts < ?`, cutoff)
	if err != nil {
		slog.Warn("metrics collector: cleanup failed", "error", err)
	}
}

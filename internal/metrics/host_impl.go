package metrics

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

type HostMetrics struct {
	CollectedAt int64 `json:"collectedAt"`

	CPUPercent float64 `json:"cpuPercent"`
	CPUCores   int     `json:"cpuCores"`
	CPUModel   string  `json:"cpuModel"`

	MemUsed    uint64  `json:"memUsed"`
	MemTotal   uint64  `json:"memTotal"`
	MemPercent float64 `json:"memPercent"`

	DiskUsed    uint64  `json:"diskUsed"`
	DiskTotal   uint64  `json:"diskTotal"`
	DiskPercent float64 `json:"diskPercent"`

	NetBytesSent uint64 `json:"netBytesSent"`
	NetBytesRecv uint64 `json:"netBytesRecv"`
}

func Collect(ctx context.Context) (HostMetrics, error) {
	now := time.Now()
	m := HostMetrics{CollectedAt: now.UnixMilli()}

	var errs []string
	recordErr := func(prefix string, err error) {
		if err == nil {
			return
		}
		errMsg := err.Error()
		if strings.TrimSpace(errMsg) == "" {
			errMsg = "unknown"
		}
		errs = append(errs, fmt.Sprintf("%s: %s", prefix, errMsg))
	}

	info, err := cpu.InfoWithContext(ctx)
	recordErr("cpu.info", err)
	cpuModel := ""
	if len(info) > 0 {
		cpuModel = strings.TrimSpace(info[0].ModelName)
	}
	m.CPUModel = cpuModel

	percents, err := cpu.PercentWithContext(ctx, 200*time.Millisecond, true)
	if err != nil {
		recordErr("cpu.percent", err)
		percents = nil
	}

	cpuPercent := 0.0
	if len(percents) > 0 {
		for _, p := range percents {
			cpuPercent += p
		}
		cpuPercent = cpuPercent / float64(len(percents))
	} else {
		// Some platforms occasionally return an empty slice for per-cpu stats.
		// Fall back to total CPU percent to avoid showing a misleading 0.0%.
		total, err2 := cpu.PercentWithContext(ctx, 200*time.Millisecond, false)
		if err2 != nil {
			recordErr("cpu.percentTotal", err2)
		} else if len(total) > 0 {
			cpuPercent = total[0]
		}
	}
	m.CPUPercent = cpuPercent

	cores, err := cpu.CountsWithContext(ctx, true)
	recordErr("cpu.counts", err)
	if cores <= 0 {
		cores = len(info)
	}
	if cores <= 0 {
		cores = 1
	}
	m.CPUCores = cores

	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		recordErr("mem.virtual", err)
		vm = nil
	}
	if vm != nil {
		m.MemUsed = vm.Used
		m.MemTotal = vm.Total
		m.MemPercent = vm.UsedPercent
	}

	diskUsage, err := disk.UsageWithContext(ctx, "/")
	if err != nil {
		recordErr("disk.usage", err)
		diskUsage = &disk.UsageStat{}
	}
	m.DiskUsed = diskUsage.Used
	m.DiskTotal = diskUsage.Total
	m.DiskPercent = diskUsage.UsedPercent

	ioCounters, err := net.IOCountersWithContext(ctx, false)
	recordErr("net.ioCounters", err)
	var sent, recv uint64
	if len(ioCounters) > 0 {
		sent = ioCounters[0].BytesSent
		recv = ioCounters[0].BytesRecv
	}
	m.NetBytesSent = sent
	m.NetBytesRecv = recv

	if ctx.Err() != nil {
		return m, ctx.Err()
	}
	if len(errs) > 0 {
		return m, errors.New(strings.Join(errs, "; "))
	}
	return m, nil
}

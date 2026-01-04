//go:build ignore

package metrics
package metrics

import (
	"context"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

type HostMetrics struct {
	CPUPercent float64 `json:"cpuPercent"`
	CPUCores   int     `json:"cpuCores"`

	MemUsed    uint64  `json:"memUsed"`
	MemTotal   uint64  `json:"memTotal"`
	MemPercent float64 `json:"memPercent"`
































































}	}, nil		NetBytesRecv: recv,		NetBytesSent: sent,		DiskPercent: diskUsage.UsedPercent,		DiskTotal:   diskUsage.Total,		DiskUsed:    diskUsage.Used,		MemPercent: vm.UsedPercent,		MemTotal:   vm.Total,		MemUsed:    vm.Used,		CPUCores:   cores,		CPUPercent: cpuPercent,	return HostMetrics{	}		recv = ioCounters[0].BytesRecv		sent = ioCounters[0].BytesSent	if len(ioCounters) > 0 {	var sent, recv uint64	ioCounters, _ := net.IOCountersWithContext(ctx, false)	}		diskUsage = &disk.UsageStat{}	if err != nil {	diskUsage, err := disk.UsageWithContext(ctx, "/")	}		return HostMetrics{}, err	if err != nil {	vm, err := mem.VirtualMemoryWithContext(ctx)	}		}			cores = 1		if cores == 0 {		cores = len(info)		info, _ := cpu.InfoWithContext(ctx)	if cores == 0 {	}		cores = 0	if err != nil {	cores, err := cpu.CountsWithContext(ctx, true)	}		cpuPercent = percents[0]	if len(percents) > 0 {	cpuPercent := 0.0	}		return HostMetrics{}, err	if err != nil {	percents, err := cpu.PercentWithContext(ctx, 200*time.Millisecond, false)func Collect(ctx context.Context) (HostMetrics, error) {}	NetBytesRecv uint64 `json:"netBytesRecv"`	NetBytesSent uint64 `json:"netBytesSent"`	DiskPercent float64 `json:"diskPercent"`	DiskTotal   uint64  `json:"diskTotal"`	DiskUsed    uint64  `json:"diskUsed"`
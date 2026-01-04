package server

import (
	"encoding/json"
)

func (s *Server) ensureDefaultSystemTools() error {
	// Seed default system widgets on a fresh install.
	// Note: migrations may create the system group even when there are no apps,
	// so we key off "no apps" rather than "no groups".
	if v, ok, err := s.store.GetKV("seed.system_widgets.v1"); err != nil {
		return err
	} else if ok && v == "1" {
		return nil
	}

	as, err := s.store.ListApps()
	if err != nil {
		return err
	}
	if len(as) != 0 {
		return nil
	}

	gs, err := s.store.ListGroups()
	if err != nil {
		return err
	}
	var gid string
	for _, g := range gs {
		if g.Kind == "system" || g.Name == "系统组件" || g.Name == "System Tools" || g.Name == "System Widgets" {
			gid = g.ID
			break
		}
	}
	if gid == "" {
		g, err := s.store.CreateGroup("系统组件", "system")
		if err != nil {
			return err
		}
		gid = g.ID
	}

	weatherDescBytes, _ := json.Marshal(map[string]any{"city": defaultWeatherCity})
	weatherDesc := string(weatherDescBytes)
	if _, err := s.store.CreateApp(&gid, "Weather", &weatherDesc, "widget:weather", nil, nil); err != nil {
		return err
	}

	clocksDescBytes, _ := json.Marshal(map[string]any{
		"clocks": []map[string]any{
			{"city": "Tokyo, Tokyo, Japan", "timezone": "Asia/Tokyo"},
			{"city": "Paris, Île-de-France, France", "timezone": "Europe/Paris"},
			{"city": "New York, NY, United States", "timezone": "America/New_York"},
			{"city": "London, England, United Kingdom", "timezone": "Europe/London"},
		},
	})
	clocksDesc := string(clocksDescBytes)
	if _, err := s.store.CreateApp(&gid, "World Clock", &clocksDesc, "widget:timezones", nil, nil); err != nil {
		return err
	}

	metricsDescBytes, _ := json.Marshal(map[string]any{"showCpu": true, "showMem": true, "showDisk": true, "showNet": true, "refreshSec": 1})
	metricsDesc := string(metricsDescBytes)
	if _, err := s.store.CreateApp(&gid, "System Status", &metricsDesc, "widget:metrics", nil, nil); err != nil {
		return err
	}

	// Mark seeded so we don't recreate widgets if a user later deletes them.
	return s.store.SetKV("seed.system_widgets.v1", "1")
}

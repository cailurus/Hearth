package widgets

import "github.com/morezhou/hearth/internal/cache"

type DataStatus struct {
	Stale      bool   `json:"stale,omitempty"`
	Refreshing bool   `json:"refreshing,omitempty"`
	Warning    string `json:"warning,omitempty"`
}

func statusFromCache(state cache.State) DataStatus {
	status := DataStatus{Stale: state.Stale, Refreshing: state.Refreshing}
	if state.Err != nil {
		status.Warning = state.Err.Error()
	}
	return status
}

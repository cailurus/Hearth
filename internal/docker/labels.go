// Package docker — labels.go: discover Hearth-renderable apps from
// container labels (hearth.* preferred, homepage.* compatible).
//
// Runtime-only: parsed apps live in a LabelDiscovery's in-memory slice
// and are rebuilt from scratch on every poll. Containers that disappear
// take their app out of the slice the next tick.

package docker

// LabelApp is one app discovered from a single container's labels.
// Names, Group, Href, etc. come straight from labels with no
// post-processing beyond trimming the prefix.
type LabelApp struct {
	ContainerID string // full container ID; used for stable React keys downstream
	Name        string
	Group       string
	Href        string
	Icon        string
	Description string
}

// parseLabels returns a populated LabelApp + true when the labels carry
// the minimum required Hearth/homepage entries (name + href). Returns
// the zero value + false otherwise — the caller skips that container.
//
// hearth.* takes precedence over homepage.* when both are present on
// the same container, on a per-field basis. So a container with
// hearth.name + homepage.href ends up with hearth's name and homepage's
// href — that's almost certainly a misconfiguration but harmless.
func parseLabels(labels map[string]string) (LabelApp, bool) {
	if len(labels) == 0 {
		return LabelApp{}, false
	}
	pick := func(field string) string {
		if v, ok := labels["hearth."+field]; ok && v != "" {
			return v
		}
		if v, ok := labels["homepage."+field]; ok && v != "" {
			return v
		}
		return ""
	}
	app := LabelApp{
		Name:        pick("name"),
		Group:       pick("group"),
		Href:        pick("href"),
		Icon:        pick("icon"),
		Description: pick("description"),
	}
	if app.Name == "" || app.Href == "" {
		return LabelApp{}, false
	}
	return app, true
}

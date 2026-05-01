package docker

import (
	"context"
	"reflect"
	"testing"
)

func TestParseLabels(t *testing.T) {
	cases := []struct {
		name     string
		labels   map[string]string
		fallback string // container name; used when label name is missing
		want     LabelApp
		wantOK   bool
	}{
		{
			name:     "hearth.* full",
			fallback: "jellyfin",
			labels: map[string]string{
				"hearth.name":        "Jellyfin",
				"hearth.group":       "Media",
				"hearth.href":        "http://nas.lan:8096/",
				"hearth.icon":        "lucide:film",
				"hearth.description": "Movie & TV server",
			},
			want: LabelApp{
				Name:        "Jellyfin",
				Group:       "Media",
				Href:        "http://nas.lan:8096/",
				Icon:        "lucide:film",
				Description: "Movie & TV server",
			},
			wantOK: true,
		},
		{
			name:     "homepage.* full",
			fallback: "plex",
			labels: map[string]string{
				"homepage.name":        "Plex",
				"homepage.group":       "Media",
				"homepage.href":        "http://nas.lan:32400/",
				"homepage.icon":        "lucide:tv",
				"homepage.description": "Streaming",
			},
			want: LabelApp{
				Name:        "Plex",
				Group:       "Media",
				Href:        "http://nas.lan:32400/",
				Icon:        "lucide:tv",
				Description: "Streaming",
			},
			wantOK: true,
		},
		{
			name:     "hearth.* wins over homepage.*",
			fallback: "jellyfin",
			labels: map[string]string{
				"hearth.name":   "Jellyfin",
				"hearth.href":   "http://hearth-href/",
				"homepage.name": "DO NOT USE",
				"homepage.href": "http://homepage-href/",
			},
			want: LabelApp{
				Name: "Jellyfin",
				Href: "http://hearth-href/",
			},
			wantOK: true,
		},
		{
			name:     "missing name → skip",
			fallback: "blah",
			labels: map[string]string{
				"hearth.href": "http://something/",
			},
			wantOK: false,
		},
		{
			name:     "missing href → skip",
			fallback: "blah",
			labels: map[string]string{
				"hearth.name": "Something",
			},
			wantOK: false,
		},
		{
			name:     "no relevant labels → skip",
			fallback: "blah",
			labels: map[string]string{
				"com.example.foo": "bar",
			},
			wantOK: false,
		},
		{
			name:     "empty labels → skip",
			fallback: "blah",
			labels:   nil,
			wantOK:   false,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := parseLabels(c.labels)
			if ok != c.wantOK {
				t.Fatalf("ok = %v, want %v", ok, c.wantOK)
			}
			if !c.wantOK {
				return
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestExtractLabelApps(t *testing.T) {
	entries := []containerListEntry{
		{
			ID:    "aaa1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/jellyfin"},
			State: "running",
			Labels: map[string]string{
				"hearth.name":  "Jellyfin",
				"hearth.href":  "http://nas.lan:8096/",
				"hearth.group": "Media",
			},
		},
		{
			ID:    "bbb1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/sonarr"},
			State: "exited", // must be filtered
			Labels: map[string]string{
				"hearth.name": "Sonarr",
				"hearth.href": "http://nas.lan:8989/",
			},
		},
		{
			ID:    "ccc1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/no-labels"},
			State: "running",
			Labels: map[string]string{}, // no relevant labels — skipped
		},
		{
			ID:    "ddd1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/missing-href"},
			State: "running",
			Labels: map[string]string{
				"hearth.name": "Incomplete",
			},
		},
		{
			ID:    "eee1111111112222222222222222222222222222222222222222222222222222",
			Names: []string{"/plex"},
			State: "RUNNING", // case-insensitive state match
			Labels: map[string]string{
				"homepage.name": "Plex",
				"homepage.href": "http://nas.lan:32400/",
			},
		},
	}

	got := extractLabelApps(entries)
	if len(got) != 2 {
		t.Fatalf("got %d apps, want 2 (jellyfin + plex). full=%+v", len(got), got)
	}
	names := []string{got[0].Name, got[1].Name}
	wantNames := map[string]bool{"Jellyfin": true, "Plex": true}
	for _, n := range names {
		if !wantNames[n] {
			t.Errorf("unexpected app %q", n)
		}
	}
	if got[0].ContainerID == "" {
		t.Error("ContainerID should be set from entry.ID")
	}
}

func TestLabelDiscoveryDisabledWhenIntervalZero(t *testing.T) {
	d := NewLabelDiscovery(nil, 0)
	d.Start(context.Background())
	if got := d.Apps(); got != nil {
		t.Errorf("Apps() with interval=0 should be nil, got %v", got)
	}
	d.Stop() // must not block / panic
}

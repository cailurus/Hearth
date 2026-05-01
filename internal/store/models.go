package store

type Group struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt int64  `json:"createdAt"`
}

type AppItem struct {
	ID          string  `json:"id"`
	GroupID     *string `json:"groupId"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	URL         string  `json:"url"`
	IconPath    *string `json:"iconPath"`
	IconSource  *string `json:"iconSource"`
	SortOrder   int     `json:"sortOrder"`
	CreatedAt   int64   `json:"createdAt"`

	// Source identifies where this app came from. "" / "manual" =
	// user-created (DB row); "docker" = synthesized from a container
	// label. The DB layer never reads or writes this field — every
	// SELECT / INSERT in store/apps.go names columns explicitly, so
	// Scan ignores Source.
	Source string `json:"source,omitempty"`
}

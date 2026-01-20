package store

// GroupRepository defines the interface for group operations.
type GroupRepository interface {
	ListGroups() ([]Group, error)
	CreateGroup(name string, kind string) (Group, error)
	UpdateGroup(id, name string) error
	DeleteGroup(id string) error
	ReorderGroups(ids []string) error
	HasSystemGroup() (bool, error)
	GroupKindByID(id string) (string, bool, error)
}

// AppRepository defines the interface for app operations.
type AppRepository interface {
	ListApps() ([]AppItem, error)
	CreateApp(groupID *string, name string, description *string, url string, iconPath, iconSource *string) (AppItem, error)
	UpdateApp(id string, groupID *string, name string, description *string, url string, iconPath, iconSource *string) error
	DeleteApp(id string) error
	ReorderApps(groupID *string, ids []string) error
	MoveGroupAppsToUngrouped(groupID string) error
	DeleteAppsByGroupID(groupID string) error
	AppByID(id string) (AppItem, bool, error)
}

// KVRepository defines the interface for key-value operations.
type KVRepository interface {
	GetKV(key string) (string, bool, error)
	SetKV(key, value string) error
}

// Repository combines all repository interfaces.
type Repository interface {
	GroupRepository
	AppRepository
	KVRepository
	Ping() error
	Migrate() error
}

// Ensure Store implements Repository.
var _ Repository = (*Store)(nil)

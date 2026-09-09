package widgets

import (
	"errors"
	"fmt"
	"strings"
)

// ConfigurePersistence is called once by the application before serving requests.
// Financial market data is deliberately excluded from disk snapshots.
func ConfigurePersistence(root string) error {
	if strings.TrimSpace(root) == "" {
		return errors.New("widget cache directory is required")
	}
	for _, configure := range []func(string) error{
		ConfigureWeatherPersistence,
		ConfigureFinancialPersistence,
		ConfigureFeedPersistence,
	} {
		if err := configure(root); err != nil {
			return fmt.Errorf("configure widget cache: %w", err)
		}
	}
	return nil
}

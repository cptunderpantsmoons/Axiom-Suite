package skills

import (
	"encoding/json"
	"os"
	"sync"
	"time"

	"github.com/laiw/management-harness/internal/core/models"
)

// DefaultPath returns the skills file path, honoring the MH_SKILLS_FILE env var.
func DefaultPath() string {
	if p := os.Getenv("MH_SKILLS_FILE"); p != "" {
		return p
	}
	return "configs/skills.json"
}

type fileData struct {
	Skills map[string]*models.Skill `json:"skills"`
}

// Store persists skills to a JSON file and exposes thread-safe load/save plus a
// change signature for hot-reload watches (mirrors config.RuntimeStore).
type Store struct {
	mu       sync.RWMutex
	path     string
	skills   map[string]*models.Skill
	exists   bool
	stopCh   chan struct{}
	stopOnce sync.Once
}

// NewStore constructs a store for the given file path.
func NewStore(path string) *Store {
	return &Store{path: path, stopCh: make(chan struct{})}
}

// Path returns the backing file path.
func (s *Store) Path() string { return s.path }

// Load reads the store from disk. A missing file is not an error.
func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.skills = map[string]*models.Skill{}
			s.exists = false
			return nil
		}
		return err
	}
	var fd fileData
	if err := json.Unmarshal(b, &fd); err != nil {
		return err
	}
	if fd.Skills == nil {
		fd.Skills = map[string]*models.Skill{}
	}
	s.skills = fd.Skills
	s.exists = true
	return nil
}

// Get returns a defensive copy of the current skills map.
func (s *Store) Get() map[string]*models.Skill {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneSkills(s.skills)
}

// Exists reports whether a persisted file was loaded.
func (s *Store) Exists() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.exists
}

// Save persists the given skills map to disk.
func (s *Store) Save(skills map[string]*models.Skill) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.MarshalIndent(fileData{Skills: skills}, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path, b, 0o600); err != nil {
		return err
	}
	s.skills = cloneSkills(skills)
	s.exists = true
	return nil
}

// Signature returns a cheap fingerprint of the on-disk file used by watchers.
func (s *Store) Signature() (size int64, mod time.Time, exists bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	fi, err := os.Stat(s.path)
	if err != nil {
		return 0, time.Time{}, false
	}
	return fi.Size(), fi.ModTime(), true
}

// Watch polls the backing file and invokes onReload when it changes.
func (s *Store) Watch(interval time.Duration, onReload func()) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		var lastSize int64
		var lastMod time.Time
		var lastExists bool
		for {
			select {
			case <-ticker.C:
				size, mod, exists := s.Signature()
				if size != lastSize || !mod.Equal(lastMod) || exists != lastExists {
					lastSize, lastMod, lastExists = size, mod, exists
					onReload()
				}
			case <-s.stopCh:
				return
			}
		}
	}()
}

// Stop terminates the watcher goroutine. Safe to call multiple times.
func (s *Store) Stop() {
	s.stopOnce.Do(func() { close(s.stopCh) })
}

func cloneSkills(m map[string]*models.Skill) map[string]*models.Skill {
	out := make(map[string]*models.Skill, len(m))
	for k, v := range m {
		if v != nil {
			c := *v
			out[k] = &c
		}
	}
	return out
}
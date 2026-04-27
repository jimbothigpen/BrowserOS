package pipeline

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"browseros-alpha/config"
)

func WriteProductionEnvFiles(agentRoot string, cfg config.Config) error {
	cfg.FillProductionEnvDefaults()
	if err := writeEnvFile(filepath.Join(agentRoot, "apps/server/.env.production"), cfg.ProductionEnv.Server); err != nil {
		return err
	}
	return writeEnvFile(filepath.Join(agentRoot, "apps/cli/.env.production"), cfg.ProductionEnv.CLI)
}

func writeEnvFile(path string, values map[string]string) error {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var out bytes.Buffer
	for _, key := range keys {
		fmt.Fprintf(&out, "%s=%s\n", key, values[key])
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, out.Bytes(), 0644)
}

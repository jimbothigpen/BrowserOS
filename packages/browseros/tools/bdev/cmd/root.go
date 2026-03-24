package cmd

import (
	"fmt"
	"strings"

	"bdev/internal/config"
	"bdev/internal/registry"

	"github.com/spf13/cobra"
)

var (
	cfg        *config.Config
	reg        *registry.Registry
	jsonOutput bool
)

var rootCmd = &cobra.Command{
	Use:   "bdev",
	Short: "BrowserOS patch workflow CLI",
	Long:  "bdev manages BrowserOS Chromium checkouts, patch sync, restacks, exports, and conflict sessions.",
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		var err error
		cfg, err = config.Load()
		if err != nil {
			return err
		}
		reg, err = registry.Load()
		return err
	},
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.PersistentFlags().BoolVar(&jsonOutput, "json", false, "output machine-readable JSON")
	rootCmd.AddGroup(
		&cobra.Group{ID: "setup", Title: "Setup:"},
		&cobra.Group{ID: "inspect", Title: "Inspect:"},
		&cobra.Group{ID: "work", Title: "Workflows:"},
		&cobra.Group{ID: "repair", Title: "Repair:"},
	)
	rootCmd.SetHelpTemplate(helpTemplate)
	cobra.AddTemplateFunc("helpHeader", func(value string) string { return value })
	cobra.AddTemplateFunc("trim", strings.TrimSpace)
}

const helpTemplate = `{{helpHeader "Usage:"}}
  {{.UseLine}}{{if .HasAvailableSubCommands}}

{{helpHeader "Commands:"}}{{range .Groups}}
{{$gid := .ID}}{{.Title}}{{range $.Commands}}{{if and .IsAvailableCommand (eq .GroupID $gid)}}
  {{rpad .Name .NamePadding }} {{.Short}}{{end}}{{end}}{{end}}{{end}}{{if .HasAvailableLocalFlags}}

{{helpHeader "Flags:"}}
{{.LocalFlags.FlagUsages | trimTrailingWhitespaces}}{{end}}{{if .HasAvailableInheritedFlags}}

{{helpHeader "Global Flags:"}}
{{.InheritedFlags.FlagUsages | trimTrailingWhitespaces}}{{end}}
`

func fail(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}

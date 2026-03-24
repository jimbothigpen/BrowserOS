package cmd

import (
	"fmt"

	"bdev/internal/engine"
	"bdev/internal/git"
	"bdev/internal/registry"
	"bdev/internal/ui"

	"github.com/spf13/cobra"
)

var (
	resetCheckout string
	resetTarget   string
)

var resetCmd = &cobra.Command{
	Use:     "reset",
	Short:   "Reset a checkout to base or to the current synced patch state",
	GroupID: "repair",
	RunE: func(cmd *cobra.Command, args []string) error {
		record, err := resolveCheckout(resetCheckout)
		if err != nil {
			return err
		}
		patchCtx, err := loadPatchContext(record)
		if err != nil {
			return err
		}
		ctx := engine.NewContext(record, patchCtx)
		switch resetTarget {
		case "base":
			err = engine.ResetToBase(ctx)
		case "synced":
			_, err = engine.ApplyAll(ctx, engine.ApplyAllOpts{Clean: true}, ui.NewActivity(!jsonOutput))
			if err == nil {
				record.LastSyncedRev, err = git.HeadRev(record.BrowserOSRepo)
			}
		default:
			return fail("reset target must be base or synced")
		}
		if err != nil {
			return err
		}
		record.LastOp = "reset"
		reg.Upsert(*record)
		if err := registry.Save(reg); err != nil {
			return err
		}
		fmt.Println(ui.Success("reset"), resetTarget)
		return nil
	},
}

func init() {
	resetCmd.Flags().StringVar(&resetCheckout, "checkout", "", "checkout name or id")
	resetCmd.Flags().StringVar(&resetTarget, "to", "base", "reset target: base or synced")
	rootCmd.AddCommand(resetCmd)
}

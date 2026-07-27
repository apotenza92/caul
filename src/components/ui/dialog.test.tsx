import { useState } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Button } from "./button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog"

function DialogExample() {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>Open preferences</DialogTrigger>
      <DialogContent>
        <DialogTitle>Preferences</DialogTitle>
        <DialogDescription>Choose how Caul behaves.</DialogDescription>
        <input aria-label="Display name" />
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
      </DialogContent>
    </Dialog>
  )
}

describe("Dialog", () => {
  it("portals an accessible popup and backdrop without nesting buttons", async () => {
    const user = userEvent.setup()
    const { container } = render(<DialogExample />)

    await user.click(screen.getByRole("button", { name: "Open preferences" }))

    const dialog = screen.getByRole("dialog", { name: "Preferences" })
    expect(dialog).toHaveAccessibleDescription("Choose how Caul behaves.")
    expect(screen.getByText("Preferences")).toHaveClass("font-heading")
    expect(screen.getByText("Preferences")).not.toHaveClass("cn-font-heading")
    expect(container).not.toContainElement(dialog)
    expect(document.body.querySelector('[data-slot="dialog-overlay"]')).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1)
  })

  it("closes with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup()
    render(<DialogExample />)

    const trigger = screen.getByRole("button", { name: "Open preferences" })
    await user.click(trigger)
    await screen.findByRole("dialog", { name: "Preferences" })

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Display name" })).toHaveFocus()
    )
    await user.keyboard("{Escape}")

    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole("dialog", { name: "Preferences" })).not.toBeInTheDocument()
  })

  it("supports controlled state and a render-composed close button", async () => {
    const user = userEvent.setup()

    function ControlledDialog() {
      const [open, setOpen] = useState(false)

      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>Open controlled</DialogTrigger>
          <DialogContent showCloseButton={false}>
            <DialogTitle>Controlled dialog</DialogTitle>
            <DialogClose render={<Button />}>Done</DialogClose>
          </DialogContent>
        </Dialog>
      )
    }

    render(<ControlledDialog />)
    await user.click(screen.getByRole("button", { name: "Open controlled" }))
    expect(screen.getByRole("dialog", { name: "Controlled dialog" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(screen.queryByRole("dialog", { name: "Controlled dialog" })).not.toBeInTheDocument()
  })
})

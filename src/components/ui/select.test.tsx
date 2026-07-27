import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

const options = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
]

function giveTriggerGeometry(trigger: HTMLElement) {
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 100, 160, 32)
  )
}

function TestSelect({
  defaultValue,
  disabled = false,
  disabledItem,
  onValueChange,
  alignItemWithTrigger,
  open,
}: {
  defaultValue?: string
  disabled?: boolean
  disabledItem?: string
  onValueChange?: (value: string | null) => void
  alignItemWithTrigger?: boolean
  open?: boolean
}) {
  return (
    <Select
      items={options}
      defaultValue={defaultValue}
      disabled={disabled}
      open={open}
      onValueChange={onValueChange}
    >
      <label htmlFor="frequency">Update frequency</label>
      <SelectTrigger id="frequency">
        <SelectValue placeholder="Choose a frequency" />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={alignItemWithTrigger}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.value === disabledItem}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

describe("Select", () => {
  it("exposes an accessible label and renders the configured value label", () => {
    render(<TestSelect defaultValue="hourly" />)

    expect(
      screen.getByRole("combobox", { name: "Update frequency" })
    ).toHaveTextContent("Hourly")
  })

  it("selects by pointer and closes", async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()

    render(<TestSelect onValueChange={onValueChange} />)

    const trigger = screen.getByRole("combobox", {
      name: "Update frequency",
    })
    giveTriggerGeometry(trigger)

    await user.click(trigger)
    const dailyOption = screen.getByRole("option", {
      hidden: true,
      name: "Daily",
    })
    fireEvent.pointerDown(dailyOption, { button: 0, pointerType: "mouse" })
    fireEvent.click(dailyOption)

    expect(trigger).toHaveTextContent("Daily")
    expect(onValueChange).toHaveBeenCalledWith("daily", expect.anything())
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("supports keyboard navigation, selection, Escape, and focus return", async () => {
    const user = userEvent.setup()

    render(<TestSelect defaultValue="hourly" />)

    const trigger = screen.getByRole("combobox", {
      name: "Update frequency",
    })
    giveTriggerGeometry(trigger)

    trigger.focus()
    await user.keyboard("{Enter}")
    await screen.findByRole("listbox")
    await user.keyboard("{End}{Enter}")
    expect(trigger).toHaveTextContent("Weekly")
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.keyboard("{Enter}")
    await screen.findByRole("listbox")
    await user.keyboard("h{Enter}")
    expect(trigger).toHaveTextContent("Hourly")

    await user.keyboard("{Enter}")
    await screen.findByRole("listbox")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("prevents a disabled trigger and skips a disabled item", async () => {
    const user = userEvent.setup()
    const { unmount } = render(<TestSelect disabled />)

    const disabledTrigger = screen.getByRole("combobox", {
      name: "Update frequency",
    })
    expect(disabledTrigger).toBeDisabled()
    await user.click(disabledTrigger)
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()

    unmount()
    render(<TestSelect defaultValue="hourly" disabledItem="daily" />)

    const trigger = screen.getByRole("combobox", {
      name: "Update frequency",
    })
    giveTriggerGeometry(trigger)
    await user.click(trigger)
    await screen.findByRole("listbox")

    expect(screen.getByRole("option", { name: "Daily" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )

    await user.keyboard("d{Enter}")
    expect(trigger).toHaveTextContent("Hourly")

    await user.keyboard("{Enter}")
    await screen.findByRole("listbox")
    await user.keyboard("w{Enter}")
    expect(trigger).toHaveTextContent("Weekly")
  })

  it("portals the popup and maps popper positioning onto the Positioner", async () => {
    const { container } = render(
      <TestSelect alignItemWithTrigger={false} open />
    )

    const popup = screen.getByRole("listbox")
    expect(container).not.toContainElement(popup)
    expect(document.body).toContainElement(popup)
    const popupContent = popup.closest('[data-slot="select-content"]')
    expect(popupContent).toHaveAttribute(
      "data-align-trigger",
      "false"
    )
    expect(popupContent).toHaveClass("z-50")
    expect(popupContent).not.toHaveClass("z-[2147483647]")
    expect(popup.closest('[data-slot="select-positioner"]')).toHaveClass(
      "z-50"
    )
  })
})

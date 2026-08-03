# Desktop UI

Caul's renderer uses the official shadcn/ui Base UI Nova preset `b2fA`. `components.json`, the exact `shadcn` and `@base-ui/react` versions, and the generated files in `src/components/ui` form the reviewed UI contract. Application code composes those generated components without changing their appearance classes. Product layout remains in `src/App.tsx` and `src/styles.css`, using the shared semantic CSS variables.

## Control map

| Caul control or state | Official component or composition |
| --- | --- |
| App actions and icon actions | `Button`, grouped with `ButtonGroup` when related |
| Persistent binary choices | `Toggle` |
| Settings navigation and multi-selection | `ToggleGroup` |
| Onboarding provider and mode panels | `Tabs` |
| Destructive confirmations | `AlertDialog` |
| Settings and editor overlays | `Dialog` |
| Text, multiline and choice forms | `Field`, `Input`, `Textarea`, `Select`, `Checkbox` and `Label` |
| Search inputs | `InputGroup` |
| Contextual pickers and download choices | `Popover` |
| Hints | `Tooltip` |
| Status and validation messages | `Alert`, `Badge` and `Spinner` |
| Download completion | `Progress` |
| Empty search and attachment results | `Empty` |
| Visual sections | `Card` and `Separator` |

Caul does not currently have application controls that require document tabs, tables, sheets, menus, radio groups, native selects, skeletons, command palettes or resizable panel primitives. Add one of those official components only when a matching product control exists.

## Domain UI exceptions

Only the following application-specific behaviours may use reviewed adapters outside `src/components/ui`:

- `AppTooltipContent` composes the official Tooltip with the private-overlay suppression boundary and scrollable transcript previews.
- `MacosWindowButton` reproduces platform traffic-light behaviour and colour constants that have no shadcn equivalent.
- `OverlayHandleButton` implements native window dragging, pointer capture and context-menu behaviour for the private overlay handle.
- `OverlayResizeHandles` exposes invisible native resize edges and corners around the desktop window.
- `VerticalToggleGroup` temporarily supplies Base UI's vertical roving-focus contract because the reviewed generated wrapper does not forward its orientation prop.

Each exception lives in `src/components/domain-ui`, carries a `data-domain-ui` marker and is covered by deterministic behaviour and accessibility tests. `VerticalToggleGroup` is the only direct Base UI import outside canonical generated files. Ordinary app controls must not be added to that directory.

## Enforcement

`npm run check:shadcn` is offline and deterministic. It rejects preset, dependency, generated-file, import, raw-control, styling and domain-exception drift. `npm run audit:shadcn` is a read-only network audit against the pinned official registry and must leave source files unchanged.

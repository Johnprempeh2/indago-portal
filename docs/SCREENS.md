# Indago portal screens (GRE-1685)

The seven v1 screens from the GRE-1681 portal, as React: Control centre, Work plan,
Gates & milestones, Risks, Investigation, Evidence and Traceability.

## Data contract

The screens never call Supabase. The data layer (GRE-1683) renders

```jsx
<IndagoApp store={{ state, canEdit, actions }} headerSlot={…} status={…} />
```

`state` has the same shape as the v1 portal's state:

| Key | Shape |
|---|---|
| `kickoff` | agreed W1 start date, `YYYY-MM-DD` or `''` |
| `wbs` | `{ id, ws, task, role, person, start, finish, deps[], exit, gate, status, actual, link, blocker }` |
| `gates` | `{ id, stage, accept, owner, status, date, exc }` |
| `ms` | `{ name, period, pre, out, status, date }` |
| `risks` | `{ id, risk, l, i, owner, resp, status }` |
| `reg` | `{ [sheet]: { cols[], rows[][] } }` for the ten register sheets in `src/model/options.mjs` |
| `check` | first-week checklist, `bool[]` |
| `toolkit` | `{ rules, authority, stages, agenda, nsq, interviews, instruments, rhythm, checklist }` |

`canEdit` is true for Editors. Viewers get no inputs, no add buttons and a "Viewer · read only" badge.

`actions` (all fire-and-forget; the data layer saves, records history and pushes live updates):

`updateWbs(id, field, value)`, `updateGate(id, field, value)`, `updateMilestone(name, field, value)`,
`updateRisk(id, field, value)`, `addRisk()`, `updateRegCell(sheet, rowId, col, value)`, `addRegRow(sheet)`,
`setKickoff(date)`, `setCheck(index, done)`.

`src/model/local-store.mjs` has the same actions as a pure reducer (`reduce`, `bindActions`), with the v1 rules:
marking work Complete or a gate Approved fills in today's date if none is set; locked client columns
(Client Findings 0–4, Information Requests 0–2) and the two client registers' row lists cannot change.
RLS is the real lock; the reducer is for optimistic updates and the demo.

Text and date fields save when they lose focus (or on Enter); selects save on change.

## Demo and tests

- `npx vite --config demo/vite.config.mjs` serves the screens on **made-up** data
  (`src/fixture/demo-state.mjs`). Add `?viewer` to the address for the Viewer role.
- `npm test` runs the model tests and `src/screens/screens.dom.test.mjs`, which mounts every screen in
  happy-dom: renders for Editor and Viewer, no editable field for a Viewer, no input on locked columns,
  save on blur, and keyboard tabs.

No client data is in this folder. The real toolkit text and register rows arrive through `state`.

## Keyboard and phone

- Tabs follow the WAI-ARIA tabs pattern: arrow keys, Home and End; one tab stop; the address keeps `#plan`, `#risks` and so on.
- "Skip to content" link; one visible focus ring on every control.
- Under 640 px, tables become one card per row with labelled fields; filters wrap two per row; the cover
  shows on the Control centre only; CSV export is one compact row under the header.
- Changing tab puts the new screen's heading just below the sticky tab bar, from any scroll position.

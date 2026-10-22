# DrawerLayout: external toggle button cannot close the drawer

## Summary

When a controlled `PeriodicityDrawerLayout` is toggled by a button that lives outside the drawer root (for example, an AppBar/Toolbar menu button), clicking the button while the drawer is open does not close it.

`DrawerLayout` handles outside `pointerdown` on `document` in the capture phase. The external button is treated as an outside click; the drawer is closed, the event is stopped, and the button's own click/toggle then runs against the already-changed state. The result is that the toggle appears dead, or the drawer closes and immediately reopens.

This is a common composition: the button that opens the drawer is part of the application toolbar, not inside `DrawerLayout`.

## Environment

- `periodicity-react`: `0.1.6`
- React: `19.0.0`
- Electron: `30.5.1` (Chromium)
- OS: Windows 10 19045
- Also reproducible in a normal browser renderer; not Electron-specific.

## Minimal reproduction

```tsx
import { useState } from "react";
import { PeriodicityDrawerLayout, PeriodicityButton } from "periodicity-react";

function Example() {
    const [open, setOpen] = useState(true);

    return (
        <>
            <PeriodicityButton onClick={() => setOpen((value) => !value)}>
                Menu
            </PeriodicityButton>

            <PeriodicityDrawerLayout
                leftOpen={open}
                onLeftOpenChange={setOpen}
                left={<nav>Navigation</nav>}
                centre={<main>Content</main>}
            />
        </>
    );
}
```

Steps:

1. Render with `open = true`.
2. Click `Menu`.
3. Click `Menu` again.

Expected: the drawer closes on the first click and opens on the second.

Actual: the drawer does not close. The button behaves as if the click was ignored or re-opened the drawer.

## Root cause

`DrawerLayout` registers an outside-close handler on `document` in the capture phase:

```ts
document.addEventListener("pointerdown", handlePointerDown, true);
```

When the pointer target is outside the drawer root:

```ts
if (rootRef.current !== null && !rootRef.current.contains(target)) {
    event.preventDefault();
    event.stopPropagation();
    setSideOpen(openSide, false);
    return;
}
```

An AppBar/Toolbar toggle is outside the DrawerLayout root, so it is indistinguishable from a click on the background/scrim. The handler consumes the pointer event before the toggle can handle it. Since the handler is registered on `document` in the capture phase, calling `stopPropagation` from the toggle's own React `onPointerDown` is too late.

## Suggested fixes

Any one of these would make external toggles safe:

1. Add a public opt-out:

```ts
closeOnOutsidePointerDown?: boolean; // default true
```

2. Add an exemption hook:

```ts
outsidePointerDownFilter?: (event: PointerEvent) => boolean;
// return false to leave the pointerdown untouched
```

or an attribute-based escape hatch:

```ts
<PeriodicityButton data-drawer-ignore-outside onClick={toggle}>
```

3. Only dismiss on the actual scrim (`.drawer-layout__scrim`) instead of every target outside the root. The scrim is the element that visually represents "click outside"; AppBar buttons are not.

4. Expose a drawer context/hook so the toggle can be rendered inside the DrawerLayout root while remaining visually in the toolbar.

## Workaround used in the consuming app

A `window` capture listener intercepts `pointerdown` on the Toolbar menu button before `document` capture, toggles the controlled state, and calls `stopImmediatePropagation()` so `DrawerLayout`'s outside-close handler never runs. This works but is brittle and should not be necessary for a public Drawer API.

## Why this matters

A menu/navigation icon that toggles the drawer from an AppBar is the standard Material drawer pattern. Requiring the toggle to be a DOM descendant of `DrawerLayout` is not obvious from the API and prevents a common layout (Coordinator/Collapse/Toolbar + DrawerLayout in the main slot).

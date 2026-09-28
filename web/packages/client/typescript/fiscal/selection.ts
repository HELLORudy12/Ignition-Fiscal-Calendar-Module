/**
 * Selection model (writeup 4 and 7). One central range replaces the per-button previous* props and the
 * setPreviousTime / turnOffButtonsTimeSelector broadcasts.
 *
 * A "path" is a node plus its ancestors, e.g. [year, period, week]. Names need the ancestors' labels.
 */
import { FiscalNode } from './calendar';

export interface Selection {
    start: number;
    end: number;               // exclusive
    name: string;              // names joined with '|'
    names: Array<string>;      // one name per selected node, chronological
    keys: Array<string>;       // one key per selected node, chronological, parallel to names
}

/**
 * Name for a single node (writeup 3.2). The year is always the fiscal year (quirk 1), not the calendar year of the
 * end date:
 *   period  P2-2024
 *   week    W5-P2-2024
 *   day     D29-W5-P2-2024
 *   year    FY2024   (not in the writeup; years only become selectable with yearToggled)
 */
export function nodeName(path: Array<FiscalNode>): string {
    const node = path[path.length - 1];

    if (node.type === 'year') {
        return `FY${node.fyYear}`;
    }

    // Labels from the clicked node back up to (not including) the year: e.g. ["W5", "P2"]
    const labels: Array<string> = [];
    for (let i = path.length - 1; i >= 0; i--) {
        if (path[i].type !== 'year') {
            labels.push(path[i].label);
        }
    }

    return labels.join('-') + '-' + node.fyYear;
}

/** Builds a selection from parallel lists of keys and names. */
function makeSelection(start: number, end: number, keys: Array<string>, names: Array<string>): Selection {
    return {
        start: start,
        end: end,
        keys: keys,
        names: names,
        name: names.join('|')
    };
}

/**
 * Applies a click to the current selection (writeup 4) and returns the new selection, or null to clear it.
 *
 * Single mode:
 *   - clicking the selected item clears the selection (quirk 3: the original sent a zero-length range)
 *   - clicking anything else selects just that item
 *
 * Multi mode, clicked item is NOT one of the selected items:
 *   - it sits inside the selection (e.g. a week inside a selected period): select just that item
 *   - it ends where the selection starts: add it to the front
 *   - it starts where the selection ends: add it to the back
 *   - otherwise: select just that item
 *
 * Multi mode, clicked item IS one of the selected items:
 *   - it's the only one: clear (quirk 3)
 *   - it's the first: drop it from the front (quirk 2: the original lost the remaining names)
 *   - it's the last: drop it from the back
 *   - it's in the middle: clear (quirk 4: the component now reports the clear to the host)
 */
export function applyClick(current: Selection | null, path: Array<FiscalNode>, multi: boolean): Selection | null {
    const node = path[path.length - 1];
    const name = nodeName(path);
    const justThisNode = makeSelection(node.start, node.end, [node.key], [name]);

    // Nothing selected yet: always select the clicked item.
    if (current === null) {
        return justThisNode;
    }

    // ---- Single mode ----
    if (!multi) {
        if (isChecked(node, current, false)) {
            return null;
        }
        return justThisNode;
    }

    // ---- Multi mode ----
    const index = current.keys.indexOf(node.key);
    const lastIndex = current.keys.length - 1;

    // Clicked item is not one of the selected items.
    if (index === -1) {
        if (isChecked(node, current, true)) {
            return justThisNode;
        }
        if (node.end === current.start) {
            const keys = [node.key].concat(current.keys);
            const names = [name].concat(current.names);
            return makeSelection(node.start, current.end, keys, names);
        }
        if (node.start === current.end) {
            const keys = current.keys.concat([node.key]);
            const names = current.names.concat([name]);
            return makeSelection(current.start, node.end, keys, names);
        }
        return justThisNode;
    }

    // Clicked item is one of the selected items: deselect it.
    if (lastIndex === 0) {
        return null;
    }
    if (index === 0) {
        const keys = current.keys.slice(1);
        const names = current.names.slice(1);
        return makeSelection(node.end, current.end, keys, names);
    }
    if (index === lastIndex) {
        const keys = current.keys.slice(0, lastIndex);
        const names = current.names.slice(0, lastIndex);
        return makeSelection(current.start, node.start, keys, names);
    }
    return null;
}

/**
 * Checked state is derived from the selection, never stored per item (writeup 7).
 *   Single mode: the item's range equals the selection exactly.
 *   Multi mode:  the item lies inside the selection.
 */
export function isChecked(node: FiscalNode, selection: Selection | null, multi: boolean): boolean {
    if (selection === null) {
        return false;
    }
    if (multi) {
        return node.start >= selection.start && node.end <= selection.end;
    }
    return node.start === selection.start && node.end === selection.end;
}

/**
 * Auto-expand rule (writeup 2.3): a year, period, or week starts expanded when the whole initial range lies inside
 * it. Uses the node's own range rather than getYear(end), so the year match uses the fiscal year (quirk 1).
 */
export function isInitiallyExpanded(node: FiscalNode, initialStart?: number, initialEnd?: number): boolean {
    if (initialStart === undefined || initialEnd === undefined) {
        return false;
    }
    if (node.type === 'day') {
        return false;
    }
    return initialStart >= node.start && initialEnd <= node.end;
}

/**
 * Turns the host's start/end props into a selection (writeup 2.3 auto-check).
 *
 * Looks for a run of items at one level that covers the range exactly, trying the biggest level first:
 * years (only if selectable), then periods, weeks, days. For example, a range covering P2 and P3 becomes
 * keys [Y2024/P2, Y2024/P3] with name "P2-2024|P3-2024".
 *
 * If no level lines up with the range, the range is still kept, with no keys or names. Multi mode will still show
 * the covered items as checked.
 */
export function selectionFromRange(tree: Array<FiscalNode>, start: number | undefined, end: number | undefined,
                                   includeYears: boolean): Selection | null {
    if (start === undefined || end === undefined || end <= start) {
        return null;
    }

    // Collect every path at each level, in chronological order (the tree is already sorted).
    const yearPaths: Array<Array<FiscalNode>> = [];
    const periodPaths: Array<Array<FiscalNode>> = [];
    const weekPaths: Array<Array<FiscalNode>> = [];
    const dayPaths: Array<Array<FiscalNode>> = [];

    for (const year of tree) {
        yearPaths.push([year]);
        for (const period of year.children) {
            periodPaths.push([year, period]);
            for (const week of period.children) {
                weekPaths.push([year, period, week]);
                for (const day of week.children) {
                    dayPaths.push([year, period, week, day]);
                }
            }
        }
    }

    const levels: Array<Array<Array<FiscalNode>>> = [];
    if (includeYears) {
        levels.push(yearPaths);
    }
    levels.push(periodPaths, weekPaths, dayPaths);

    for (const paths of levels) {
        // Items at this level that lie inside the range.
        const inside: Array<Array<FiscalNode>> = [];
        for (const path of paths) {
            const node = path[path.length - 1];
            if (node.start >= start && node.end <= end) {
                inside.push(path);
            }
        }

        if (coversExactly(inside, start, end)) {
            const keys: Array<string> = [];
            const names: Array<string> = [];
            for (const path of inside) {
                keys.push(path[path.length - 1].key);
                names.push(nodeName(path));
            }
            return makeSelection(start, end, keys, names);
        }
    }

    return makeSelection(start, end, [], []);
}

/** True if the paths' nodes run from start to end with no gaps. */
function coversExactly(paths: Array<Array<FiscalNode>>, start: number, end: number): boolean {
    if (paths.length === 0) {
        return false;
    }

    let expectedStart = start;
    for (const path of paths) {
        const node = path[path.length - 1];
        if (node.start !== expectedStart) {
            return false;
        }
        expectedStart = node.end;
    }

    return expectedStart === end;
}

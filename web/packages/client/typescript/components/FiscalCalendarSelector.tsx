/**
 * PowerBI-style fiscal period / week / day picker. Replaces the TimeSelectionBox view tree described in
 * FiscalCalendarSelector-writeup.md.
 *
 * Looks and behaves like a Perspective Dropdown: the component itself is a box showing the current label, and
 * clicking it opens a panel below with the fiscal tree. The panel is rendered at the page level (a React portal), like
 * Perspective's own dropdowns, so containers with hidden overflow don't clip it.
 *
 * The tree is built in ../fiscal/calendar.ts and the click rules live in ../fiscal/selection.ts.
 */
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {
    Component,
    ComponentMeta,
    ComponentProps,
    PComponent,
    PropertyTree,
    SizeObject,
    StyleProps
} from '@inductiveautomation/perspective-client';
import { bind } from 'bind-decorator';
import { buildTree, CalendarRow, FiscalNode, parseCalendar, ParseResult, validateTree } from '../fiscal/calendar';
import { applyClick, isChecked, isInitiallyExpanded, Selection, selectionFromRange } from '../fiscal/selection';

// Must match FiscalCalendarSelector.COMPONENT_ID on the Java side.
export const COMPONENT_TYPE = "chaffin.input.fiscalcalendarselector";

// Popup sizing, in px.
const POPUP_GAP = 4;            // space between the box and the popup
const POPUP_MAX_HEIGHT = 400;
const POPUP_MIN_WIDTH = 280;
const VIEWPORT_MARGIN = 8;      // keep the popup this far from the window edges

interface FiscalCalendarSelectorProps {
    calendar: ParseResult;
    start?: number;
    end?: number;
    multi: boolean;
    yearToggled: boolean;
    weekToggled: boolean;
    dayToggled: boolean;
    label: string;
    placeholderText: string;
    placeholderColor: string;
    showClearIcon: boolean;
    enabled: boolean;
    dropdownStyle: StyleProps;
}

interface PopupPosition {
    left: number;
    width: number;
    maxHeight: number;
    top?: number;       // set when the popup opens below the box
    bottom?: number;    // set when it opens above (not enough room below)
}

interface FiscalCalendarSelectorState {
    expanded: Record<string, boolean>;
    selection: Selection | null;
    popupOpen: boolean;
    popupPosition: PopupPosition | null;
}

export class FiscalCalendarSelector extends Component<ComponentProps<FiscalCalendarSelectorProps>, FiscalCalendarSelectorState> {
    state: FiscalCalendarSelectorState = {
        expanded: {},
        selection: null,
        popupOpen: false,
        popupPosition: null
    };

    // The tree is rebuilt only when the parsed rows change, not on every render.
    private treeRows?: Array<CalendarRow>;
    private tree: Array<FiscalNode> = [];

    // The start/end props that the current selection was last taken from, as "start|end".
    private appliedRange?: string;

    // The popup panel's DOM element, used to tell clicks inside it from clicks outside.
    private popupElement: HTMLDivElement | null = null;

    componentDidMount(): void {
        this.syncSelectionFromProps();
    }

    componentDidUpdate(): void {
        this.syncSelectionFromProps();

        // Close the popup if the component gets disabled while it's open.
        if (this.state.popupOpen && !this.canOpen()) {
            this.closePopup();
        }
    }

    componentWillUnmount(): void {
        this.removeWindowListeners();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Tree and selection
    // ---------------------------------------------------------------------------------------------------------------

    private getTree(): Array<FiscalNode> {
        const rows = this.props.props.calendar.rows;
        if (rows !== this.treeRows) {
            this.treeRows = rows;
            this.tree = buildTree(rows);

            const problems = validateTree(this.tree);
            if (problems.length > 0) {
                console.warn(`FiscalCalendarSelector: periodCalendar has ${problems.length} problem(s)`, problems);
            }
        }
        return this.tree;
    }

    /**
     * Takes the selection from props.start/end (writeup 2.3) once the calendar has loaded, and again whenever
     * start/end change.
     *
     * At runtime this also fills in the output props, so a host bound to selectedName etc. shows the initial
     * selection right away. It does not fire onSelectionChange (only a user click does), and it doesn't write in
     * Designer design mode, where writes would change the saved view.
     */
    private syncSelectionFromProps(): void {
        const tree = this.getTree();
        if (tree.length === 0) {
            return;  // calendar not loaded yet, e.g. the tag binding hasn't delivered a value
        }

        const { start, end, yearToggled } = this.props.props;
        const range = `${start}|${end}`;
        if (range === this.appliedRange) {
            return;
        }
        this.appliedRange = range;

        const selection = selectionFromRange(tree, start, end, yearToggled);
        this.setState({ selection });

        if (this.props.eventsEnabled) {
            this.writeOutputs(selection);
        }
    }

    /**
     * Writes the output props. Dates are written as epoch millis; if a host binding needs a real date, use toDate()
     * in the binding.
     */
    private writeOutputs(selection: Selection | null): void {
        const props = this.props.store.props;
        props.write('selectedStart', selection ? selection.start : null);
        props.write('selectedEnd', selection ? selection.end : null);
        props.write('selectedName', selection ? selection.name : '');
        props.write('selectedKeys', selection ? selection.keys : []);
    }

    /** A user changed the selection: update state, write the output props, and fire onSelectionChange. */
    private commitSelection(selection: Selection | null): void {
        this.setState({ selection });
        this.writeOutputs(selection);

        this.props.componentEvents.fireComponentEvent('onSelectionChange', {
            start: selection ? selection.start : null,
            end: selection ? selection.end : null,
            name: selection ? selection.name : ''
        });
    }

    private isExpanded(node: FiscalNode): boolean {
        const stored = this.state.expanded[node.key];
        if (stored !== undefined) {
            return stored;
        }
        return isInitiallyExpanded(node, this.props.props.start, this.props.props.end);
    }

    @bind
    private onToggle(node: FiscalNode): void {
        const expanded = { ...this.state.expanded };
        expanded[node.key] = !this.isExpanded(node);
        this.setState({ expanded });
    }

    /** A tree item was clicked. In single mode the popup closes afterwards, like a normal dropdown. */
    @bind
    private onSelect(path: Array<FiscalNode>): void {
        this.commitSelection(applyClick(this.state.selection, path, this.props.props.multi));

        if (!this.props.props.multi) {
            this.closePopup();
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Popup open / close / position
    // ---------------------------------------------------------------------------------------------------------------

    /** The popup only opens at runtime (not in Designer design mode) and when the component is enabled. */
    private canOpen(): boolean {
        return this.props.eventsEnabled && this.props.props.enabled;
    }

    private openPopup(): void {
        if (!this.canOpen()) {
            return;
        }
        this.setState({ popupOpen: true, popupPosition: this.measurePopupPosition() });
        this.addWindowListeners();
    }

    @bind
    private closePopup(): void {
        if (this.state.popupOpen) {
            this.setState({ popupOpen: false });
        }
        this.removeWindowListeners();
    }

    @bind
    private onBoxClick(): void {
        if (this.state.popupOpen) {
            this.closePopup();
        } else {
            this.openPopup();
        }
    }

    @bind
    private onBoxKeyDown(e: React.KeyboardEvent): void {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            this.openPopup();
        } else if (e.key === 'Escape') {
            this.closePopup();
        }
    }

    @bind
    private onClearClick(e: React.MouseEvent): void {
        e.stopPropagation();  // don't also open the popup
        if (this.canOpen()) {
            this.commitSelection(null);
        }
    }

    /**
     * Works out where the popup goes: below the box, lined up with its left edge and at least as wide. If there isn't
     * enough room below and there's more room above, it opens above instead.
     */
    private measurePopupPosition(): PopupPosition | null {
        const element = this.props.store.element as HTMLElement | undefined;
        if (!element) {
            return null;
        }

        const box = element.getBoundingClientRect();
        const spaceBelow = window.innerHeight - box.bottom - POPUP_GAP - VIEWPORT_MARGIN;
        const spaceAbove = box.top - POPUP_GAP - VIEWPORT_MARGIN;
        const width = Math.max(box.width, POPUP_MIN_WIDTH);
        const left = Math.max(VIEWPORT_MARGIN, Math.min(box.left, window.innerWidth - width - VIEWPORT_MARGIN));

        const opensAbove = spaceBelow < POPUP_MAX_HEIGHT && spaceAbove > spaceBelow;
        if (opensAbove) {
            return {
                left: left,
                width: width,
                maxHeight: Math.min(POPUP_MAX_HEIGHT, spaceAbove),
                bottom: window.innerHeight - box.top + POPUP_GAP
            };
        }

        return {
            left: left,
            width: width,
            maxHeight: Math.min(POPUP_MAX_HEIGHT, spaceBelow),
            top: box.bottom + POPUP_GAP
        };
    }

    private addWindowListeners(): void {
        document.addEventListener('mousedown', this.onDocumentMouseDown, true);
        document.addEventListener('keydown', this.onDocumentKeyDown, true);
        window.addEventListener('resize', this.onWindowMoved);
        window.addEventListener('scroll', this.onWindowMoved, true);
    }

    private removeWindowListeners(): void {
        document.removeEventListener('mousedown', this.onDocumentMouseDown, true);
        document.removeEventListener('keydown', this.onDocumentKeyDown, true);
        window.removeEventListener('resize', this.onWindowMoved);
        window.removeEventListener('scroll', this.onWindowMoved, true);
    }

    /** Clicking anywhere outside the box and the popup closes it. */
    @bind
    private onDocumentMouseDown(e: MouseEvent): void {
        const target = e.target as Node;
        const box = this.props.store.element as HTMLElement | undefined;

        const insideBox = !!box && box.contains(target);
        const insidePopup = !!this.popupElement && this.popupElement.contains(target);
        if (!insideBox && !insidePopup) {
            this.closePopup();
        }
    }

    @bind
    private onDocumentKeyDown(e: KeyboardEvent): void {
        if (e.key === 'Escape') {
            this.closePopup();
        }
    }

    /** Keep the popup attached to the box when the page scrolls or the window resizes. */
    @bind
    private onWindowMoved(e: Event): void {
        // Scrolling inside the popup itself doesn't move the box.
        if (this.popupElement && e.target instanceof Node && this.popupElement.contains(e.target)) {
            return;
        }
        this.setState({ popupPosition: this.measurePopupPosition() });
    }

    @bind
    private setPopupElement(element: HTMLDivElement | null): void {
        this.popupElement = element;
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------------------------------------------------

    /** The children to show under a node, based on weekToggled and dayToggled. */
    private visibleChildren(node: FiscalNode): Array<FiscalNode> {
        const { weekToggled, dayToggled } = this.props.props;

        if (node.type === 'period' && !weekToggled) {
            return [];
        }
        if (node.type === 'week' && !dayToggled) {
            return [];
        }
        return node.children;
    }

    /**
     * Renders one node as a row: [chevron] [checkbox] [label] ... [dates], then its children indented underneath
     * when expanded.
     *  - The chevron only appears when the node has visible children; otherwise a blank space keeps labels aligned.
     *  - Clicking the checkbox or the label selects the node. Clicking the chevron expands or collapses it.
     *  - Years have no checkbox unless yearToggled is on; clicking a year's label expands or collapses it instead.
     */
    private renderNode(node: FiscalNode, ancestors: Array<FiscalNode>): React.ReactNode {
        const path = ancestors.concat([node]);
        const children = this.visibleChildren(node);
        const hasChildren = children.length > 0;
        const expanded = hasChildren && this.isExpanded(node);
        const selectable = node.type !== 'year' || this.props.props.yearToggled;
        const checked = selectable && isChecked(node, this.state.selection, this.props.props.multi);

        // Chevron (rotated by CSS when expanded), or a blank placeholder the same width.
        let toggle: React.ReactNode;
        if (hasChildren) {
            toggle = (
                <span className={expanded ? 'fcs-toggle fcs-open' : 'fcs-toggle'} onClick={() => this.onToggle(node)}>
                    <Chevron />
                </span>
            );
        } else {
            toggle = <span className="fcs-toggle" />;
        }

        const label = node.type === 'year' ? `FY${node.fyYear}` : node.label;

        let rowClass = 'fcs-row';
        if (checked) {
            rowClass += ' fcs-checked';
        }

        // What clicking the checkbox/label does.
        let onRowClick: () => void;
        if (selectable) {
            onRowClick = () => this.onSelect(path);
        } else {
            onRowClick = () => this.onToggle(node);
        }

        const onRowKey = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onRowClick();
            }
        };

        return (
            <div key={node.key} className={`fcs-node fcs-${node.type}`}>
                <div className={rowClass} title={`${formatDate(node.start)}-${formatDate(node.end)}`}>
                    {toggle}
                    <span className="fcs-select"
                          role={selectable ? 'checkbox' : 'button'}
                          aria-checked={selectable ? checked : undefined}
                          tabIndex={0}
                          onClick={onRowClick}
                          onKeyDown={onRowKey}>
                        {selectable && <span className="fcs-checkbox" />}
                        <span className="fcs-label">{label}</span>
                        <span className="fcs-dates">{describeRange(node)}</span>
                    </span>
                </div>
                {expanded &&
                    <div className="fcs-children">
                        {children.map(child => this.renderNode(child, path))}
                    </div>}
            </div>
        );
    }

    /**
     * The popup panel, rendered into document.body. Positioning comes first so dropdownStyle can override the look
     * (and width/maxHeight), but position/top/bottom/left always come from the measurement.
     */
    private renderPopup(): React.ReactNode {
        const position = this.state.popupPosition;
        if (!this.state.popupOpen || !position) {
            return null;
        }

        const { calendar, dropdownStyle } = this.props.props;

        const style: React.CSSProperties = {
            width: position.width,
            maxHeight: position.maxHeight,
            ...dropdownStyle.style,
            position: 'fixed',
            left: position.left,
            top: position.top,
            bottom: position.bottom
        };

        let className = 'fcs-popup';
        if (dropdownStyle.className) {
            className += ' ' + dropdownStyle.className;
        }

        let content: React.ReactNode;
        if (calendar.error) {
            content = <div className="fcs-message fcs-error">{calendar.error}</div>;
        } else {
            content = this.getTree().map(year => this.renderNode(year, []));
        }

        // Stop clicks here from bubbling (through the portal) to the component root and firing its mouse events.
        const popup = (
            <div ref={this.setPopupElement}
                 className={className}
                 style={style}
                 onClick={e => e.stopPropagation()}
                 onMouseDown={e => e.stopPropagation()}>
                {content}
            </div>
        );

        return ReactDOM.createPortal(popup, document.body);
    }

    render() {
        const { props, emit } = this.props;
        const { label, placeholderText, placeholderColor, showClearIcon } = props;
        const selection = this.state.selection;
        const open = this.state.popupOpen;

        // Box text: the label prop if set, otherwise the selection's name, otherwise the placeholder.
        let text = label;
        let isPlaceholder = false;
        if (!text && selection && selection.name) {
            text = selection.name;
        }
        if (!text) {
            text = placeholderText;
            isPlaceholder = true;
        }

        const classes = ['fiscal-calendar-selector'];
        if (open) {
            classes.push('fcs-box-open');
        }
        if (!props.enabled) {
            classes.push('fcs-disabled');
        }

        const showClear = showClearIcon && props.enabled && selection !== null;

        // The root element must not set its own ref (emit() provides one); this.props.store.element gives the DOM node.
        return (
            <div {...emit({ classes })}>
                <div className="fcs-box"
                     role="combobox"
                     aria-expanded={open}
                     aria-disabled={!props.enabled}
                     tabIndex={props.enabled ? 0 : -1}
                     onClick={this.onBoxClick}
                     onKeyDown={this.onBoxKeyDown}>
                    <span className={isPlaceholder ? 'fcs-box-text fcs-placeholder' : 'fcs-box-text'}
                          style={isPlaceholder && placeholderColor ? { color: placeholderColor } : undefined}
                          title={text}>
                        {text}
                    </span>
                    {showClear &&
                        <span className="fcs-clear" title="Clear" onClick={this.onClearClick}>
                            <svg viewBox="0 0 16 16" width="12" height="12">
                                <path d="M4 4 L12 12 M12 4 L4 12" fill="none" stroke="currentColor" strokeWidth="1.75"
                                      strokeLinecap="round" />
                            </svg>
                        </span>}
                    <span className="fcs-box-chevron"><Chevron /></span>
                </div>
                {this.renderPopup()}
            </div>
        );
    }
}

/** Small right-pointing chevron; CSS rotates it. */
function Chevron(): JSX.Element {
    return (
        <svg viewBox="0 0 16 16" width="12" height="12">
            <path d="M6 3.5 L10.5 8 L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.75"
                  strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

/**
 * Short, readable dates shown on the right of each row. End dates are exclusive, so the last day shown is the day
 * before `end`.
 *   day     Sun, Jan 28
 *   year    Dec 31, 2023 – Dec 28, 2024
 *   others  Jan 28 – Feb 24
 */
function describeRange(node: FiscalNode): string {
    const first = new Date(node.start);

    if (node.type === 'day') {
        return first.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }

    const last = new Date(node.end);
    last.setDate(last.getDate() - 1);

    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (node.type === 'year') {
        options.year = 'numeric';
    }
    return `${first.toLocaleDateString('en-US', options)} – ${last.toLocaleDateString('en-US', options)}`;
}

function formatDate(millis: number): string {
    const d = new Date(millis);
    const pad = (n: number) => (n < 10 ? '0' : '') + n;
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${pad(d.getFullYear() % 100)}`;
}

export class FiscalCalendarSelectorMeta implements ComponentMeta {
    getComponentType(): string {
        return COMPONENT_TYPE;
    }

    // Same default size as a Perspective Dropdown.
    getDefaultSize(): SizeObject {
        return ({
            width: 200,
            height: 32
        });
    }

    getPropsReducer(tree: PropertyTree): FiscalCalendarSelectorProps {
        const start = tree.readDate('start');
        const end = tree.readDate('end');
        return {
            calendar: parseCalendar(tree.readDataset('periodCalendar')),
            start: start ? start.getTime() : undefined,
            end: end ? end.getTime() : undefined,
            multi: tree.readBoolean('multi', false),
            yearToggled: tree.readBoolean('yearToggled', false),
            weekToggled: tree.readBoolean('weekToggled', true),
            dayToggled: tree.readBoolean('dayToggled', false),
            label: tree.readString('label', ''),
            placeholderText: tree.readString('placeholder.text', 'Select...'),
            placeholderColor: tree.readString('placeholder.color', ''),
            showClearIcon: tree.readBoolean('showClearIcon', false),
            enabled: tree.readBoolean('enabled', true),
            dropdownStyle: tree.readStyle('dropdownStyle').toStyleProps()
        };
    }

    getViewComponent(): PComponent {
        return FiscalCalendarSelector;
    }
}

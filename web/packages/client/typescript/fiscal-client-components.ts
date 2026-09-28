import { ComponentMeta, ComponentRegistry } from '@inductiveautomation/perspective-client';
import { FiscalCalendarSelector, FiscalCalendarSelectorMeta } from './components/FiscalCalendarSelector';

// Export so the components are referencable, e.g. `FiscalCalendar['FiscalCalendarSelector']`.
export { FiscalCalendarSelector };

import '../scss/main';

// As new components are implemented, import them and add their meta to this array.
const components: Array<ComponentMeta> = [
    new FiscalCalendarSelectorMeta()
];

// Register each component with Perspective. Each one must also be registered on the Java side (gateway and designer
// hooks), with the same component ID.
components.forEach((c: ComponentMeta) => ComponentRegistry.register(c));

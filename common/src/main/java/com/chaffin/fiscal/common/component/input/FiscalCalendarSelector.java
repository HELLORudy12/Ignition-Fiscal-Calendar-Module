package com.chaffin.fiscal.common.component.input;

import java.util.List;

import com.chaffin.fiscal.common.FiscalCalendar;
import com.inductiveautomation.ignition.common.jsonschema.JsonSchema;
import com.inductiveautomation.perspective.common.api.ComponentDescriptor;
import com.inductiveautomation.perspective.common.api.ComponentDescriptorImpl;
import com.inductiveautomation.perspective.common.api.ComponentEventDescriptor;

/**
 * Meta information about the FiscalCalendarSelector component. See docs/FiscalCalendarSelector-writeup.md for
 * behavior.
 */
public class FiscalCalendarSelector {
    // Must match COMPONENT_TYPE in web/packages/client/typescript/components/FiscalCalendarSelector.tsx.
    public static String COMPONENT_ID = "chaffin.input.fiscalcalendarselector";

    public static JsonSchema SCHEMA =
        JsonSchema.parse(FiscalCalendar.class.getResourceAsStream("/fiscalcalendarselector.props.json"));

    // Fired from the client whenever the user changes the selected range.
    public static ComponentEventDescriptor SELECTION_CHANGE_EVENT = new ComponentEventDescriptor(
        "onSelectionChange",
        "Fired when the selected fiscal range changes.",
        JsonSchema.parse(FiscalCalendar.class.getResourceAsStream("/fiscalcalendarselector.onSelectionChange.json"))
    );

    public static ComponentDescriptor DESCRIPTOR = builder().build();

    /**
     * A builder preloaded with this component's settings. The designer uses it to add the palette icon, which
     * can't be set here because the icon classes only exist in designer scope.
     */
    public static ComponentDescriptorImpl.ComponentBuilder builder() {
        return ComponentDescriptorImpl.ComponentBuilder.newBuilder()
            .setPaletteCategory(FiscalCalendar.COMPONENT_CATEGORY)
            .setId(COMPONENT_ID)
            .setModuleId(FiscalCalendar.MODULE_ID)
            .setSchema(SCHEMA)
            .setEvents(List.of(SELECTION_CHANGE_EVENT))
            .setName("Fiscal Calendar Selector")
            .addPaletteEntry("", "Fiscal Calendar Selector", "Selects a fiscal period, week, or day range.", null, null)
            .setDefaultMetaName("fiscalCalendarSelector")
            .setResources(FiscalCalendar.BROWSER_RESOURCES);
    }

}

package com.chaffin.fiscal.designer;

import com.chaffin.fiscal.common.component.input.FiscalCalendarSelector;
import com.inductiveautomation.ignition.common.BundleUtil;
import com.inductiveautomation.ignition.common.licensing.LicenseState;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.designer.model.AbstractDesignerModuleHook;
import com.inductiveautomation.ignition.designer.model.DesignerContext;
import com.inductiveautomation.ignition.designer.navtree.icon.InteractiveSvgIcon;
import com.inductiveautomation.perspective.designer.DesignerComponentRegistry;
import com.inductiveautomation.perspective.designer.api.PerspectiveDesignerInterface;

/**
 * Designer-scope entry point. Adds the component to the Perspective component palette.
 * Registered in the ignitionModule block of the root build.gradle.kts.
 */
public class FiscalCalendarDesignerHook extends AbstractDesignerModuleHook {
    private static final LoggerEx logger = LoggerEx.newBuilder().build("FiscalCalendar.DesignerHook");

    private DesignerComponentRegistry registry;

    static {
        BundleUtil.get().addBundle("fiscalcalendar", FiscalCalendarDesignerHook.class.getClassLoader(), "fiscalcalendar");
    }

    @Override
    public void startup(DesignerContext context, LicenseState activationState) {
        logger.info("Registering Fiscal Calendar components in the Designer.");

        this.registry = PerspectiveDesignerInterface.get(context).getDesignerComponentRegistry();
        // createIconAll also loads the -selected and -disabled variants next to the base SVG.
        this.registry.registerComponent(
            FiscalCalendarSelector.builder()
                .setIcon(InteractiveSvgIcon.createIconAll(
                    FiscalCalendarDesignerHook.class,
                    "/com/chaffin/fiscal/designer/images/fiscal-calendar-selector.svg"))
                .build()
        );
    }

    @Override
    public void shutdown() {
        if (this.registry != null) {
            this.registry.removeComponent(FiscalCalendarSelector.COMPONENT_ID);
        }
    }
}

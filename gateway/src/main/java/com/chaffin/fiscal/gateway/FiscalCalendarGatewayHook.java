package com.chaffin.fiscal.gateway;

import java.util.Optional;

import com.chaffin.fiscal.common.FiscalCalendar;
import com.chaffin.fiscal.common.component.input.FiscalCalendarSelector;
import com.inductiveautomation.ignition.common.licensing.LicenseState;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.model.AbstractGatewayModuleHook;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;
import com.inductiveautomation.perspective.common.api.ComponentRegistry;
import com.inductiveautomation.perspective.gateway.api.PerspectiveContext;

/**
 * Gateway-scope entry point. Registers the component with Perspective and serves the web files.
 * Registered in the ignitionModule block of the root build.gradle.kts.
 */
public class FiscalCalendarGatewayHook extends AbstractGatewayModuleHook {

    private static final LoggerEx log = LoggerEx.newBuilder().build("FiscalCalendar.GatewayHook");

    private GatewayContext gatewayContext;
    private ComponentRegistry componentRegistry;

    @Override
    public void setup(GatewayContext context) {
        this.gatewayContext = context;
        log.info("Setting up Fiscal Calendar module.");
    }

    @Override
    public void startup(LicenseState activationState) {
        PerspectiveContext perspectiveContext = PerspectiveContext.get(this.gatewayContext);
        this.componentRegistry = perspectiveContext.getComponentRegistry();

        if (this.componentRegistry != null) {
            log.info("Registering Fiscal Calendar components.");
            this.componentRegistry.registerComponent(FiscalCalendarSelector.DESCRIPTOR);
        } else {
            log.error("Perspective component registry not found; Fiscal Calendar components will not work.");
        }
    }

    @Override
    public void shutdown() {
        log.info("Shutting down Fiscal Calendar module.");
        if (this.componentRegistry != null) {
            this.componentRegistry.removeComponent(FiscalCalendarSelector.COMPONENT_ID);
        }
    }

    // The web build puts FiscalCalendar.js/.css in the "mounted" resource folder of the web jar.
    @Override
    public Optional<String> getMountedResourceFolder() {
        return Optional.of("mounted");
    }

    // Serves the mounted folder at http://<gateway>/res/fiscalcalendar/*
    @Override
    public Optional<String> getMountPathAlias() {
        return Optional.of(FiscalCalendar.URL_ALIAS);
    }

    @Override
    public boolean isFreeModule() {
        return true;
    }

    @Override
    public boolean isMakerEditionCompatible() {
        return true;
    }
}

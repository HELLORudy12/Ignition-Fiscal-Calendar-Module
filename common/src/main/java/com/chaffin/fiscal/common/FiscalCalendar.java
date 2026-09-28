package com.chaffin.fiscal.common;

import java.util.Set;

import com.inductiveautomation.perspective.common.api.BrowserResource;

/**
 * Module-wide constants shared by the gateway and designer scopes.
 */
public class FiscalCalendar {

    // Must match the id in the ignitionModule block of the root build.gradle.kts.
    public static final String MODULE_ID = "com.chaffin.fiscal";

    // Web files are served from http://<gateway>/res/fiscalcalendar/*
    public static final String URL_ALIAS = "fiscalcalendar";

    // Perspective's built-in Input palette category, so the component sits next to Dropdown and friends.
    public static final String COMPONENT_CATEGORY = "input";

    // The JS and CSS bundles built by web/packages/client (see LibName in its webpack.config.js).
    public static final Set<BrowserResource> BROWSER_RESOURCES =
        Set.of(
            new BrowserResource(
                "fiscal-calendar-js",
                String.format("/res/%s/FiscalCalendar.js", URL_ALIAS),
                BrowserResource.ResourceType.JS
            ),
            new BrowserResource(
                "fiscal-calendar-css",
                String.format("/res/%s/FiscalCalendar.css", URL_ALIAS),
                BrowserResource.ResourceType.CSS
            )
        );
}

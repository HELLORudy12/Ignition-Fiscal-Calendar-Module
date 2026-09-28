import java.util.concurrent.TimeUnit


plugins {
    base
    // the ignition module plugin: https://github.com/inductiveautomation/ignition-module-tools
    id("io.ia.sdk.modl") version("0.1.1")
    id("org.barfuin.gradle.taskinfo") version "2.1.0"
}

allprojects {
    version = "1.0.0"
    group = "com.chaffin.fiscal"
}

ignitionModule {
    // name of the .modl file to build
    fileName.set("FiscalCalendar")

    // module xml configuration
    name.set("Fiscal Calendar")
    id.set("com.chaffin.fiscal")
    moduleVersion.set("${project.version}")
    moduleDescription.set("Perspective fiscal calendar selector component.")
    requiredIgnitionVersion.set("8.3.0")
    license.set("license.html")

    // If we depend on other module being loaded/available, then we specify IDs of the module we depend on,
    // and specify the Ignition Scope that applies. "G" for gateway, "D" for designer, "C" for VISION client
    // (this module does not run in the scope of a Vision client, so we don't need a "C" entry here)
    moduleDependencies.put("com.inductiveautomation.perspective", "DG")

    // map of 'Gradle Project Path' to Ignition Scope in which the project is relevant.  This is is combined with
    // the dependency declarations within the subproject's build.gradle.kts in order to determine which
    // dependencies need to be bundled with the module and added to the module.xml.
    projectScopes.putAll(
        mapOf(
            ":gateway" to "G",
            ":web" to "G",
            ":designer" to "D",
            ":common" to "GD"
        )
    )

    // 'hook classes' are the things that Ignition loads and runs when your module is installed.  This map tells
    // Ignition which classes should be loaded in a given scope.
    hooks.putAll(
        mapOf(
            "com.chaffin.fiscal.gateway.FiscalCalendarGatewayHook" to "G",
            "com.chaffin.fiscal.designer.FiscalCalendarDesignerHook" to "D"
        )
    )
    // Signing settings come from ignition.signing.* in ~/.gradle/gradle.properties (see README).
    skipModlSigning.set(false)
}


val deepClean by tasks.registering {
    dependsOn(allprojects.map { "${it.path}:clean" })
    description = "Executes clean tasks and remove node plugin caches."
    doLast {
        delete(file(".gradle"))
    }
}

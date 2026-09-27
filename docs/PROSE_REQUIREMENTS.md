# 5G ProSe prerequisites

Ordinary cellular IP access works through TCP where an IP route exists. Native 5G ProSe needs a sidelink-capable UE/baseband with applicable 3GPP TS 23.304 release support, a documented vendor API, a device discovery/addressing mechanism, authorized network/operator configuration where required, and a security context for peer enrollment. No such device or API is available in this environment. A ProSe adapter can register at the transport boundary once these prerequisites and a two-device test harness exist. Current status: `BLOCKED_BY_EXTERNAL_DEPENDENCY`.

# Hardware acceptance tests

No local socket or simulator counts as a physical bearer. Before enabling a hardware test, connect two independent endpoints and record device models, firmware, region/channel where relevant, message ID, intent hash, link metrics, signed receipt and transport path. Run these tests on a dedicated, trusted runner with access to the devices. The default CI intentionally runs software tests only.

Status remains `BLOCKED_BY_EXTERNAL_DEPENDENCY` until physical evidence is recorded. A test skipped because a device is absent must never be reported as a passing hardware test.

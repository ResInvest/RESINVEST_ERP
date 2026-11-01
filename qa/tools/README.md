# QA first-users — browser tools

One Chromium daemon per simulated user (isolated context = own localStorage, own data).

```bash
# start (background), one per user, unique port
node qa/tools/browser-daemon.cjs --port 9301 --out qa/first-users/run-1/<id> [--mobile] [--net slow3g] [--cpu 4] &
# act
qa/tools/b.sh 9301 '{"action":"goto","url":"http://127.0.0.1:8080/index.html"}'
qa/tools/b.sh 9301 '{"action":"observe"}'            # visible text + numbered interactive elements (i)
qa/tools/b.sh 9301 '{"action":"click","i":18}'
qa/tools/b.sh 9301 '{"action":"fill","i":14,"value":"..."}'
qa/tools/b.sh 9301 '{"action":"screenshot","name":"01-landing"}'
qa/tools/b.sh 9301 '{"action":"logs","clear":true}'  # console errors, page errors, failed requests, dialogs
qa/tools/b.sh 9301 '{"action":"close"}'
```

Actions: `goto, observe, click, dblclick, tap, fill, type, press, select, check, hover, scroll, screenshot,
back, reload, wait, newTab, switchTab, tabs, tapTargets, eval, logs, close`.
Targets: `i` (from the latest observe), `text`, `role`+`name`, `label`, `selector`.
`--mobile` = 375×812, touch, DPR 3; `--net slow3g` = CDP Network.emulateNetworkConditions (DevTools Slow 3G);
`--cpu 4` = CDP Emulation.setCPUThrottlingRate 4.
Native `alert/confirm` dialogs are auto-accepted and recorded in `logs.dialogs`.

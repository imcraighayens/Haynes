# Extracted Quik1 design source (from quik1-design/claude-design.html)
- app.dc.jsx      – main app logic (React class `Component extends DCLogic`, ~1.6k lines, 184KB). All screens/state/validation.
- template.html   – Claude Design template markup (sc-if/{{ }} bindings, CSS, @font-face). DC <script> removed (-> app.dc.jsx).
- props.json      – design knobs: brand, interestRate 35%, adminApprovedAmount, longerTermsUnlocked, demoWithdrawUnlocked, whiteBackground, lightNavBar.
- quik1-link.js   – localStorage('quik1-link-v1') + BroadcastChannel fake backend (submitApplication/submitSignup/submitRequest/decide/confirmRepayment).
- dc-runtime.js   – Claude Design runtime (generated). React 18.3.1 UMD is bundled (not copied).
- outer-wrapper.html – bundler shell with base64 stripped.
- manifest-index.json – uuid,mime,size,sha1 of every embedded resource. Asset files keep their uuid names (template refers to them by uuid); q1Logo.png = 84e6f8b7….

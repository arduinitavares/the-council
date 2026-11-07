# Hosted macOS validation design review

The corrected design is ready for the user to choose a validation environment. It is not implementation or runtime acceptance.

Frozen design SHA256: 7d91ff5cb1fffd0cc1527d1af7b10b88af67c6c7bd18d1f9c0c15cd2469b0c7f. Shared review artifact: e39a9ae8a5c9bcbe77dcdbff30f856b6ae2408d9a75ac189a35105071f0900c1.

Astra Ultra completed with provider exit0 in147.021seconds and reported ready/PASS. Its owned processes and terminal are settled and closed. A fresh Argon high review of the identical source completed with provider exit0 in182.25seconds after reading all16 declared context chunks. It reported ready/PASS and implementationReady=false. The coordinator checked every chunk's reconstructed bytes/hash and the completed read records.

The first Argon R2 entry disclosed a truncated packet, so its pass was excluded. The replacement delivery used109375 inline bytes and chunks no larger than11995bytes. The replacement's wrapper retained STRUCTURED_REVIEW_INVALID because its public response contained two JSON objects. The final public object equals the canonical typed structured_output, which the coordinator validated against every applicable supplied-schema constraint and the frozen artifact. The original error is preserved, alongside a separate reconciliation; it is not relabeled as a clean wrapper result. Its provider, children and exact owned terminal are positively settled and closed.

The coordinator verified the substantive findings against source and primary evidence:

- Fresh test VMs need their own bounded builds: actual tests import dist directly and no dist files are tracked. The corrected design supplies those builds.
- Cause-specific old-source assertion RED and corrected-source GREEN remain mandatory. Prior meaningful causal evidence is retained and hardware differences cannot erase it.
- Command status, deadlines and fixture settlement require an actual supervisor implementation. Its code and runtime evidence remain later gates; process sampling and VM disposal cannot substitute.
- Actual Actions settings, PR2 metadata, ancestry, pinned action references and official platform facts now accompany the review packet. Isolated selective delivery preserves incomplete #5 work and private evidence.

One source caveat remains explicit for implementation: test/store/crash-window.test.ts reaps its child but does not remove its mkdtemp root. A declared cleanup owner must remove and verify that directory within the settlement limit. Watchdog signalling, install-script behavior, offline behavior and all command/runtime outcomes are also still unverified.

No workflow, product implementation, commit, push, hosted job, merge or issue closure is approved by this review. The full #3-#10 goal and parent acceptance criteria remain unchanged. User design choice is the next gate; an approved choice is followed by the implementation plan and actual-source reviews.

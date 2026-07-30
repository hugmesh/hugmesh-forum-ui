# hugmesh-forum-ui — developer make targets.
#
# `make pentest` runs the repo-local pen-test self-scan that MIRRORS the CI
# `pentest:*` jobs (.gitlab-ci.yml -> centralized .pentest-sca / .pentest-dast-
# baseline from hugmesh-generator/tests/pentest/ci/pentest-stage.gitlab-ci.yml).
# It is self-contained and never hard-fails when tooling or a DAST target is
# absent, so it is safe to run on any dev box.

# Centralized DAST harness (run-pentest.sh) source of truth. Override either var
# to point at a local checkout / a different ref.
PENTEST_HARNESS_DIR ?= ../hugmesh-generator/tests/pentest
PENTEST_HARNESS_REPO ?= https://github.com/hugmesh-net/hugmesh-generator.git

.PHONY: pentest pentest-sca pentest-dast

# Full local pen-test self-scan: SCA (mirrors pentest:sca) + DAST when a target
# is configured (mirrors pentest:dast).
pentest: pentest-sca pentest-dast

# SCA — OWASP Dependency-Check over this Angular repo, mirroring .pentest-sca.
# Quick local signal via `npm audit`; the authoritative Dependency-Check scan
# runs in CI (and can be run locally via the owasp/dependency-check docker image
# noted below). Non-blocking: matches CI allow_failure.
pentest-sca:
	@echo "== pentest:sca (SCA self-scan, mirrors CI .pentest-sca) =="
	@if command -v npm >/dev/null 2>&1; then \
		echo "-> npm audit --audit-level=high"; \
		npm audit --audit-level=high || echo "   (npm audit reported findings — triage; non-blocking locally)"; \
	else \
		echo "   npm not found — skipping npm audit (install Node.js to run it)"; \
	fi
	@echo "-> full SCA in CI uses OWASP Dependency-Check. To reproduce locally:"
	@echo "     docker run --rm -v \"$$PWD:/src\" owasp/dependency-check:latest \\"
	@echo "       --project hugmesh-forum-ui --scan /src --out /src/reports/sca \\"
	@echo "       --failOnCVSS 9 --enableExperimental --format HTML --format JSON"

# DAST — delegate to the centralized harness (run-pentest.sh), mirroring
# .pentest-dast-baseline. Only runs when DAST_TARGET_URL is set; otherwise a
# no-op note so the target stays green for local builds with no live target.
pentest-dast:
	@echo "== pentest:dast (DAST baseline, mirrors CI .pentest-dast-baseline) =="
	@if [ -z "$(DAST_TARGET_URL)" ]; then \
		echo "   DAST_TARGET_URL not set — skipping DAST (set it to a running env-test-build URL)."; \
		echo "   When set, this delegates to the centralized harness:"; \
		echo "     DAST_TARGET_URL=$$DAST_TARGET_URL bash $(PENTEST_HARNESS_DIR)/run-pentest.sh \\"; \
		echo "       --env compose --scan baseline --pipeline main"; \
	elif [ -x "$(PENTEST_HARNESS_DIR)/run-pentest.sh" ]; then \
		echo "-> using harness at $(PENTEST_HARNESS_DIR)"; \
		DAST_TARGET_URL="$(DAST_TARGET_URL)" bash "$(PENTEST_HARNESS_DIR)/run-pentest.sh" \
			--env compose --scan baseline --pipeline main || \
			echo "   (DAST reported findings — triage; non-blocking locally)"; \
	else \
		echo "   Harness not found at $(PENTEST_HARNESS_DIR)."; \
		echo "   Clone it, then re-run:"; \
		echo "     git clone $(PENTEST_HARNESS_REPO) /tmp/hugmesh-generator"; \
		echo "     make pentest-dast PENTEST_HARNESS_DIR=/tmp/hugmesh-generator/tests/pentest"; \
	fi

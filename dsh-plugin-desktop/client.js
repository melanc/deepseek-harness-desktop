window.__ModuleLoader__.load({
	id: "dsh-community-market",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region src/client/MarketLauncher.tsx
		/** Storefront glyph for the first-class Community Market home entry. */
		function MarketStoreIcon({ size = 16 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				"data-icon": "market-store",
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M2.25 6.25v6.5c0 .55.45 1 1 1h9.5c.55 0 1-.45 1-1v-6.5",
						stroke: "currentColor",
						strokeWidth: "1.25",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M1.5 5.75 2.75 2.5h10.5l1.25 3.25a2 2 0 0 1-3.25 1.55A2 2 0 0 1 8 7.3a2 2 0 0 1-3.25 0A2 2 0 0 1 1.5 5.75Z",
						stroke: "currentColor",
						strokeWidth: "1.25",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M6 13.75v-3.5h4v3.5",
						stroke: "currentColor",
						strokeWidth: "1.25",
						strokeLinejoin: "round"
					})
				]
			});
		}
		function MarketLauncher({ wide, useStore, actions, t }) {
			const open = useStore((state) => state.open);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: t("tab"),
				delayMs: 500,
				disabled: wide,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					className: "dshMarketLauncher",
					"data-wide": wide,
					"aria-label": t("tab"),
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketStoreIcon, { size: wide ? 16 : 18 }),
					onClick: () => actions.open(),
					children: wide ? t("tab") : null
				})
			});
		}
		//#endregion
		//#region src/media/ref.ts
		/** Convert an opaque Host-issued reference into the only renderer-facing asset URL. */
		function marketMediaAssetUrl(assetRef) {
			return `/api/community-market/assets?ref=${encodeURIComponent(assetRef)}`;
		}
		//#endregion
		//#region src/client/api.ts
		const CATALOG_PAGE_LIMIT = 50;
		async function readJson(response) {
			const value = await response.json();
			if (!response.ok) throw new MarketApiError(typeof value.error === "string" ? value.error : `request failed: ${response.status}`, response.status, typeof value.code === "string" ? value.code : void 0, typeof value.details === "string" ? value.details : void 0);
			return value;
		}
		/** HTTP facts used to localize safe Client-facing Market failures. */
		var MarketApiError = class extends Error {
			status;
			code;
			details;
			constructor(message, status, code, details) {
				super(message);
				this.status = status;
				this.code = code;
				this.details = details;
				this.name = "MarketApiError";
			}
		};
		async function readMarketState(signal) {
			return await readJson(await fetch("/api/community-market/state", {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}));
		}
		function marketCatalogUrl(sourceRecordId, q, locale, categories) {
			const url = new URL("/api/community-market/catalog", window.location.origin);
			url.searchParams.set("sourceRecordId", sourceRecordId);
			if (q.trim()) url.searchParams.set("q", q.trim());
			for (const category of categories) url.searchParams.append("category", category);
			url.searchParams.set("limit", String(CATALOG_PAGE_LIMIT));
			url.searchParams.set("locale", locale);
			return url;
		}
		async function readMarketCatalog(sourceRecordId, q, locale, categories, signal, refresh = false) {
			const url = marketCatalogUrl(sourceRecordId, q, locale, categories);
			if (refresh) url.searchParams.set("refresh", "1");
			return await readJson(await fetch(url, {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}));
		}
		async function readMoreMarketCatalog(sourceRecordId, cursor, q, locale, categories, signal) {
			const url = marketCatalogUrl(sourceRecordId, q, locale, categories);
			url.searchParams.set("cursor", cursor);
			return await readJson(await fetch(url, {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}));
		}
		async function mutateMarketSource(mutation, signal) {
			return (await readJson(await fetch("/api/community-market/sources", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(mutation),
				...signal === void 0 ? {} : { signal }
			}))).sources;
		}
		async function readMarketInstallations(signal) {
			return await readJson(await fetch("/api/community-market/installations", {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}));
		}
		async function readMarketInstallable(locale, options = {}, signal) {
			const url = new URL("/api/community-market/installable", window.location.origin);
			url.searchParams.set("locale", locale);
			if (options.q?.trim()) url.searchParams.set("q", options.q.trim());
			for (const category of options.categories ?? []) url.searchParams.append("category", category);
			if (options.sourceRecordId !== void 0) url.searchParams.set("sourceRecordId", options.sourceRecordId);
			if (options.cursor !== void 0) url.searchParams.set("cursor", options.cursor);
			if (options.refresh === true) url.searchParams.set("refresh", "1");
			return await readJson(await fetch(url, {
				cache: "no-store",
				...signal === void 0 ? {} : { signal }
			}));
		}
		async function previewMarketOperation(request, signal) {
			return await readJson(await fetch("/api/community-market/operations/preview", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(request),
				...signal === void 0 ? {} : { signal }
			}));
		}
		async function executeMarketOperation(previewId, signal) {
			return await readJson(await fetch("/api/community-market/operations/execute", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ previewId }),
				...signal === void 0 ? {} : { signal }
			}));
		}
		async function openMarketTerminal(signal) {
			return await readJson(await fetch("/api/community-market/desktop/open-terminal", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
				...signal === void 0 ? {} : { signal }
			}));
		}
		async function requestMarketRestart(restartToken, signal) {
			return await readJson(await fetch("/api/community-market/desktop/request-restart", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ restartToken }),
				...signal === void 0 ? {} : { signal }
			}));
		}
		//#endregion
		//#region src/client/MarketSettingsTab.tsx
		const INSTALL_REQUIREMENTS_DOCS = {
			en: "https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/install-and-uninstall.md",
			zh: "https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/install-and-uninstall.zh.md"
		};
		const CATALOG_ADAPTER_GUIDE_DOCS = {
			en: "https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/catalog-adapter-guide.md",
			zh: "https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-community-market/docs/catalog-adapter-guide.zh.md"
		};
		const DSH_DESKTOP_ISSUES_URL = "https://github.com/anywhere-labs/deepseek-harness-desktop/issues";
		function installRequirementsUrl(locale) {
			return locale.toLowerCase().startsWith("zh") ? INSTALL_REQUIREMENTS_DOCS.zh : INSTALL_REQUIREMENTS_DOCS.en;
		}
		function catalogAdapterGuideUrl(locale) {
			return locale.toLowerCase().startsWith("zh") ? CATALOG_ADAPTER_GUIDE_DOCS.zh : CATALOG_ADAPTER_GUIDE_DOCS.en;
		}
		function visibleItemKey(value) {
			return `${value.source.sourceRecordId}\0${value.source.providerId}\0${value.item.id}\0${value.item.package?.name ?? ""}`;
		}
		function matchingInstallation(value, installations) {
			const packageName = value.item.package?.name;
			if (packageName === void 0) return void 0;
			const matches = installations.filter((installation) => installation.packageName === packageName);
			return matches.length === 1 ? matches[0] : void 0;
		}
		function isDesktopUnavailable(cause) {
			return cause !== null && typeof cause === "object" && "status" in cause && cause.status === 503;
		}
		function operationErrorMessage(cause, fallback) {
			return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
		}
		function operationErrorDetails(cause) {
			const details = cause !== null && typeof cause === "object" && "details" in cause ? cause.details : void 0;
			return typeof details === "string" && details.trim().length > 0 ? details : void 0;
		}
		function catalogFailureMessage(cause, source, t) {
			const code = cause !== null && typeof cause === "object" && "code" in cause ? cause.code : void 0;
			const reason = code === "catalog-timeout" ? t("catalogFailureTimeout") : code === "catalog-invalid-response" ? t("catalogFailureInvalidResponse") : t("catalogFailureUnavailable");
			return `${t("catalogFailureSource")}: ${source.name}. ${reason}`;
		}
		function PluginIcon({ item, large = false }) {
			const icon = item.media?.icon;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: large ? "dshMarketGlyph dshMarketGlyphLarge" : "dshMarketGlyph",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCordisPluginOutline14, { size: large ? 28 : 20 }), icon !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					src: marketMediaAssetUrl(icon.assetRef),
					alt: "",
					loading: "lazy",
					decoding: "async",
					referrerPolicy: "no-referrer",
					onError: (event) => {
						event.currentTarget.remove();
					}
				})]
			});
		}
		function retainEnabledCatalog(catalog, sources) {
			if (catalog === void 0) return void 0;
			const selected = [...sources].filter((source) => source.enabled).sort((left, right) => left.order - right.order).at(0);
			if (selected === void 0) return void 0;
			const result = catalog.results.find((value) => value.source.sourceRecordId === selected.sourceRecordId);
			return result === void 0 ? void 0 : {
				...catalog,
				results: [{
					...result,
					source: selected
				}]
			};
		}
		function selectedSource(sources) {
			return [...sources].filter((source) => source.enabled).sort((left, right) => left.order - right.order).at(0);
		}
		function mergeCatalogPages(catalog, pages, manualInstall) {
			if (catalog === void 0 || pages.length === 0) return catalog;
			const updates = new Map(pages.map((page) => [page.source.sourceRecordId, page]));
			const results = catalog.results.map((current) => {
				const next = updates.get(current.source.sourceRecordId);
				if (current.snapshot === void 0 || next?.snapshot === void 0) return current;
				const seen = /* @__PURE__ */ new Set();
				const items = [...current.snapshot.items, ...next.snapshot.items].filter((item) => {
					if (seen.has(item.id)) return false;
					seen.add(item.id);
					return true;
				});
				return {
					...next,
					source: current.source,
					snapshot: {
						...next.snapshot,
						items,
						page: next.snapshot.page
					}
				};
			});
			const hints = new Map([...catalog.manualInstall, ...manualInstall].map((hint) => [`${hint.sourceRecordId}:${hint.itemId}`, hint]));
			return {
				...catalog,
				results,
				manualInstall: [...hints.values()],
				fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		}
		function mergeInstallablePages(current, next) {
			if (current === void 0 || current.source.sourceRecordId !== next.source.sourceRecordId) return next;
			const seen = /* @__PURE__ */ new Set();
			const items = [...current.items, ...next.items].filter((item) => {
				if (seen.has(item.id)) return false;
				seen.add(item.id);
				return true;
			});
			const hints = new Map([...current.manualInstall, ...next.manualInstall].map((hint) => [`${hint.sourceRecordId}:${hint.itemId}`, hint]));
			return {
				...next,
				items,
				categories: next.categories.length === 0 ? current.categories : next.categories,
				manualInstall: [...hints.values()]
			};
		}
		function MarketSurface({ initialView = "installable", readLocale, t, showHeader = true }) {
			const [view, setView] = (0, react.useState)(initialView);
			const [state, setState] = (0, react.useState)();
			const [catalog, setCatalog] = (0, react.useState)();
			const [query, setQuery] = (0, react.useState)("");
			const [appliedQuery, setAppliedQuery] = (0, react.useState)("");
			const [categoryOptions, setCategoryOptions] = (0, react.useState)([]);
			const [selectedCategories, setSelectedCategories] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(false);
			const [loadingMore, setLoadingMore] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [loadMoreError, setLoadMoreError] = (0, react.useState)();
			const [selected, setSelected] = (0, react.useState)();
			const [addOpen, setAddOpen] = (0, react.useState)(false);
			const [manifestUrl, setManifestUrl] = (0, react.useState)("");
			const [mutationError, setMutationError] = (0, react.useState)();
			const [mutationPending, setMutationPending] = (0, react.useState)(false);
			const [installations, setInstallations] = (0, react.useState)([]);
			const [installableIndex, setInstallableIndex] = (0, react.useState)();
			const [installableQuery, setInstallableQuery] = (0, react.useState)("");
			const [appliedInstallableQuery, setAppliedInstallableQuery] = (0, react.useState)("");
			const [installableCategories, setInstallableCategories] = (0, react.useState)([]);
			const [installableLoaded, setInstallableLoaded] = (0, react.useState)(false);
			const [installableLoading, setInstallableLoading] = (0, react.useState)(false);
			const [installableLoadingMore, setInstallableLoadingMore] = (0, react.useState)(false);
			const [installableUnavailable, setInstallableUnavailable] = (0, react.useState)(false);
			const [installableError, setInstallableError] = (0, react.useState)();
			const [installationsLoaded, setInstallationsLoaded] = (0, react.useState)(false);
			const [installationsLoading, setInstallationsLoading] = (0, react.useState)(false);
			const [installationsUnavailable, setInstallationsUnavailable] = (0, react.useState)(false);
			const [installationsError, setInstallationsError] = (0, react.useState)();
			const [selectedInstallation, setSelectedInstallation] = (0, react.useState)();
			const [selectedInventoryLoading, setSelectedInventoryLoading] = (0, react.useState)(false);
			const [selectedInventoryError, setSelectedInventoryError] = (0, react.useState)();
			const [operationPreview, setOperationPreview] = (0, react.useState)();
			const [operationSuccess, setOperationSuccess] = (0, react.useState)();
			const [operationError, setOperationError] = (0, react.useState)();
			const [operationErrorDetailsValue, setOperationErrorDetailsValue] = (0, react.useState)();
			const [operationExecutionFailed, setOperationExecutionFailed] = (0, react.useState)(false);
			const [operationPending, setOperationPending] = (0, react.useState)(false);
			const [desktopActionError, setDesktopActionError] = (0, react.useState)();
			const [desktopActionPending, setDesktopActionPending] = (0, react.useState)(false);
			const readRequest = (0, react.useRef)();
			const pageRequest = (0, react.useRef)();
			const mutationRequest = (0, react.useRef)();
			const installableRequest = (0, react.useRef)();
			const installationsRequest = (0, react.useRef)();
			const operationRequest = (0, react.useRef)();
			const operationStage = (0, react.useRef)();
			const desktopActionRequest = (0, react.useRef)();
			const selectedKeyRef = (0, react.useRef)();
			const viewRef = (0, react.useRef)(initialView);
			const rememberCategories = (0, react.useCallback)((next) => {
				setCategoryOptions([...next.categories].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" })));
			}, []);
			const loadCatalog = (0, react.useCallback)(async (nextState, q, categories, forceRefresh = false) => {
				readRequest.current?.abort();
				pageRequest.current?.abort();
				pageRequest.current = void 0;
				setLoadingMore(false);
				setLoadMoreError(void 0);
				const selected = selectedSource(nextState.sources);
				if (selected === void 0) {
					readRequest.current = void 0;
					setCatalog(void 0);
					setQuery("");
					setAppliedQuery("");
					setCategoryOptions([]);
					setSelectedCategories([]);
					setError(void 0);
					setLoading(false);
					return;
				}
				const effectiveQuery = q.trim();
				const request = new AbortController();
				readRequest.current = request;
				setLoading(true);
				setError(void 0);
				let catalogApplied = false;
				const applyCatalog = (next) => {
					const retained = retainEnabledCatalog(next, nextState.sources);
					const result = retained?.results[0];
					if (retained === void 0 || result?.snapshot === void 0) return void 0;
					rememberCategories(retained);
					setAppliedQuery(effectiveQuery);
					setSelectedCategories([...categories]);
					setCatalog(retained);
					catalogApplied = true;
					return retained;
				};
				try {
					const next = forceRefresh ? await readMarketCatalog(selected.sourceRecordId, effectiveQuery, readLocale(), categories, request.signal, true) : await readMarketCatalog(selected.sourceRecordId, effectiveQuery, readLocale(), categories, request.signal);
					if (!request.signal.aborted && readRequest.current === request) {
						const retained = applyCatalog(next);
						if (retained === void 0) {
							setError(catalogFailureMessage({ code: "catalog-invalid-response" }, selected, t));
							return;
						}
						if (!forceRefresh && effectiveQuery === "" && categories.length === 0 && retained.results[0]?.stale === true) {
							const refreshed = await readMarketCatalog(selected.sourceRecordId, effectiveQuery, readLocale(), categories, request.signal, true);
							if (!request.signal.aborted && readRequest.current === request) applyCatalog(refreshed);
						}
					}
				} catch (cause) {
					if (!request.signal.aborted && readRequest.current === request && !catalogApplied) setError(catalogFailureMessage(cause, selected, t));
				} finally {
					if (readRequest.current === request) {
						readRequest.current = void 0;
						setLoading(false);
					}
				}
			}, [
				readLocale,
				rememberCategories,
				t
			]);
			const loadState = (0, react.useCallback)(async (q, categories, forceRefresh = false, loadCatalogAfterState = true) => {
				if (mutationRequest.current !== void 0) return;
				readRequest.current?.abort();
				pageRequest.current?.abort();
				pageRequest.current = void 0;
				setLoadingMore(false);
				setLoadMoreError(void 0);
				const request = new AbortController();
				readRequest.current = request;
				setLoading(true);
				setError(void 0);
				try {
					const next = await readMarketState(request.signal);
					if (request.signal.aborted || readRequest.current !== request) return;
					setState(next);
					setCatalog((current) => retainEnabledCatalog(current, next.sources));
					readRequest.current = void 0;
					if (!loadCatalogAfterState) {
						if (viewRef.current === "discover") await loadCatalog(next, q, categories, forceRefresh);
						else setLoading(false);
						return;
					}
					await loadCatalog(next, q, categories, forceRefresh);
				} catch {
					if (!request.signal.aborted && readRequest.current === request) setError(t("catalogError"));
				} finally {
					if (readRequest.current === request) {
						readRequest.current = void 0;
						setLoading(false);
					}
				}
			}, [loadCatalog, t]);
			const loadInstallations = (0, react.useCallback)(async () => {
				installationsRequest.current?.abort();
				const request = new AbortController();
				installationsRequest.current = request;
				setInstallationsLoading(true);
				setInstallationsError(void 0);
				setInstallationsUnavailable(false);
				try {
					const response = await readMarketInstallations(request.signal);
					if (request.signal.aborted || installationsRequest.current !== request) return;
					setInstallations(response.installations);
					setInstallationsLoaded(true);
					setInstallationsUnavailable(false);
					return { installations: response.installations };
				} catch (cause) {
					if (request.signal.aborted || installationsRequest.current !== request) return;
					const message = isDesktopUnavailable(cause) ? t("desktopUnavailable") : operationErrorMessage(cause, t("installationsError"));
					setInstallationsUnavailable(isDesktopUnavailable(cause));
					setInstallationsError(message);
					return { error: message };
				} finally {
					if (installationsRequest.current === request) {
						installationsRequest.current = void 0;
						setInstallationsLoading(false);
					}
				}
			}, [t]);
			const loadInstallable = (0, react.useCallback)(async (refresh = false, q = "", categories = [], page) => {
				installableRequest.current?.abort();
				const request = new AbortController();
				installableRequest.current = request;
				const append = page !== void 0;
				if (append) setInstallableLoadingMore(true);
				else {
					setInstallableIndex(void 0);
					setInstallableLoaded(false);
					setInstallableLoading(true);
				}
				setInstallableError(void 0);
				setInstallableUnavailable(false);
				try {
					const response = await readMarketInstallable(readLocale(), {
						...q.trim() === "" ? {} : { q: q.trim() },
						...categories.length === 0 ? {} : { categories },
						...page === void 0 ? {} : page,
						refresh
					}, request.signal);
					if (request.signal.aborted || installableRequest.current !== request) return;
					setInstallableIndex((current) => append ? mergeInstallablePages(current, response) : response);
					setInstallableLoaded(true);
					setInstallableUnavailable(false);
					setAppliedInstallableQuery(q.trim());
					setInstallableCategories([...categories]);
				} catch (cause) {
					if (request.signal.aborted || installableRequest.current !== request) return;
					if (!append) {
						setInstallableIndex(void 0);
						setInstallableLoaded(false);
					}
					setInstallableUnavailable(isDesktopUnavailable(cause));
					setInstallableError(isDesktopUnavailable(cause) ? t("desktopUnavailable") : t("installableError"));
				} finally {
					if (installableRequest.current === request) {
						installableRequest.current = void 0;
						if (append) setInstallableLoadingMore(false);
						else setInstallableLoading(false);
					}
				}
			}, [readLocale, t]);
			(0, react.useEffect)(() => {
				setQuery("");
				if (viewRef.current === "installable") {
					loadState("", [], false, false);
					loadInstallable(false, "", []);
				} else loadState("", []);
				return () => {
					readRequest.current?.abort();
					pageRequest.current?.abort();
					mutationRequest.current?.abort();
					installableRequest.current?.abort();
					installationsRequest.current?.abort();
					operationRequest.current?.abort();
					desktopActionRequest.current?.abort();
					readRequest.current = void 0;
					pageRequest.current = void 0;
					mutationRequest.current = void 0;
					installableRequest.current = void 0;
					installationsRequest.current = void 0;
					operationRequest.current = void 0;
					desktopActionRequest.current = void 0;
				};
			}, [loadInstallable, loadState]);
			(0, react.useEffect)(() => {
				if (view === "discover" && state !== void 0 && selectedSource(state.sources) !== void 0 && catalog === void 0 && readRequest.current === void 0) loadCatalog(state, appliedQuery, selectedCategories);
			}, [
				view,
				state,
				catalog,
				appliedQuery,
				selectedCategories,
				loadCatalog
			]);
			const items = (0, react.useMemo)(() => catalog?.results.flatMap((result) => (result.snapshot?.items ?? []).map((item) => ({
				item,
				source: result.source,
				stale: result.stale
			}))) ?? [], [catalog]);
			const installableCategoryOptions = installableIndex?.categories ?? [];
			const installableItems = (0, react.useMemo)(() => (installableIndex?.items ?? []).map((item) => ({
				item,
				source: installableIndex.source,
				stale: false
			})), [installableIndex]);
			const pageTarget = (0, react.useMemo)(() => catalog?.results.flatMap((result) => {
				const cursor = result.snapshot?.page?.nextCursor;
				return cursor === void 0 ? [] : [{
					sourceRecordId: result.source.sourceRecordId,
					cursor
				}];
			}).at(0), [catalog]);
			const partialFailure = catalog?.results.some((result) => result.error !== void 0) ?? false;
			const currentSource = state === void 0 ? void 0 : selectedSource(state.sources);
			const currentSourceHref = currentSource === void 0 ? void 0 : safeHttpsExternalHref(currentSource.homepage) ?? safeHttpsExternalHref(currentSource.attribution?.url);
			const selectedManualInstall = (0, react.useMemo)(() => {
				if (selected === void 0) return void 0;
				return (view === "installable" ? installableIndex?.manualInstall ?? [] : catalog?.manualInstall ?? []).find((hint) => hint.sourceRecordId === selected.source.sourceRecordId && hint.providerId === selected.source.providerId && hint.itemId === selected.item.id);
			}, [
				catalog,
				installableIndex,
				selected,
				view
			]);
			const mutate = async (mutation) => {
				if (mutationRequest.current !== void 0) return false;
				readRequest.current?.abort();
				pageRequest.current?.abort();
				installableRequest.current?.abort();
				readRequest.current = void 0;
				pageRequest.current = void 0;
				installableRequest.current = void 0;
				setLoading(false);
				setLoadingMore(false);
				setLoadMoreError(void 0);
				const request = new AbortController();
				mutationRequest.current = request;
				setMutationPending(true);
				setMutationError(void 0);
				try {
					const sources = await mutateMarketSource(mutation, request.signal);
					if (request.signal.aborted || mutationRequest.current !== request) return false;
					const next = {
						sources,
						builtIns: state?.builtIns ?? [],
						desktopActions: state?.desktopActions ?? {
							openTerminal: false,
							requestRestart: false
						}
					};
					const sourceChanged = selectedSource(state?.sources ?? [])?.sourceRecordId !== selectedSource(sources)?.sourceRecordId;
					setState(next);
					if (sourceChanged) {
						setCatalog(void 0);
						setInstallableIndex(void 0);
						setInstallableLoaded(false);
						setInstallableLoading(false);
						setInstallableLoadingMore(false);
						setInstallableUnavailable(false);
						setInstallableError(void 0);
						setInstallableQuery("");
						setAppliedInstallableQuery("");
						setInstallableCategories([]);
						setQuery("");
						setAppliedQuery("");
						setCategoryOptions([]);
						setSelectedCategories([]);
						selectedKeyRef.current = void 0;
						setSelected(void 0);
					} else setCatalog((current) => retainEnabledCatalog(current, sources));
					mutationRequest.current = void 0;
					setMutationPending(false);
					await loadCatalog(next, sourceChanged ? "" : appliedQuery, sourceChanged ? [] : selectedCategories);
					return true;
				} catch {
					if (!request.signal.aborted && mutationRequest.current === request) setMutationError(t("sourceError"));
					return false;
				} finally {
					if (mutationRequest.current === request) {
						mutationRequest.current = void 0;
						setMutationPending(false);
					}
				}
			};
			const toggleCategory = (category) => {
				if (state === void 0) return;
				const categories = selectedCategories.includes(category) ? selectedCategories.filter((value) => value !== category) : [...selectedCategories, category];
				selectedKeyRef.current = void 0;
				setSelected(void 0);
				loadCatalog(state, appliedQuery, categories);
			};
			const loadMore = async () => {
				if (pageRequest.current !== void 0 || pageTarget === void 0) return;
				const request = new AbortController();
				pageRequest.current = request;
				setLoadingMore(true);
				setLoadMoreError(void 0);
				try {
					const next = await readMoreMarketCatalog(pageTarget.sourceRecordId, pageTarget.cursor, appliedQuery, readLocale(), selectedCategories, request.signal);
					if (request.signal.aborted || pageRequest.current !== request) return;
					const page = next.results.find((value) => value.source.sourceRecordId === pageTarget.sourceRecordId);
					if (page?.snapshot === void 0 || page.error !== void 0) {
						setLoadMoreError(t("loadMoreError"));
						return;
					}
					rememberCategories(next);
					setCatalog((current) => mergeCatalogPages(current, [page], next.manualInstall));
				} catch {
					if (!request.signal.aborted && pageRequest.current === request) setLoadMoreError(t("loadMoreError"));
				} finally {
					if (pageRequest.current === request) {
						pageRequest.current = void 0;
						setLoadingMore(false);
					}
				}
			};
			const selectMarketView = (next) => {
				if (viewRef.current === next) return;
				viewRef.current = next;
				setView(next);
				selectedKeyRef.current = void 0;
				setSelected(void 0);
				setOperationError(void 0);
				setOperationErrorDetailsValue(void 0);
				setOperationExecutionFailed(false);
				if (next === "installable") {
					installationsRequest.current?.abort();
					installationsRequest.current = void 0;
					setInstallationsLoading(false);
					loadInstallable(false, appliedInstallableQuery, installableCategories);
				} else if (next === "installed") {
					installableRequest.current?.abort();
					installableRequest.current = void 0;
					setInstallableLoading(false);
					setInstallableLoadingMore(false);
					loadInstallations();
				} else if (next === "discover") {
					installableRequest.current?.abort();
					installationsRequest.current?.abort();
					installableRequest.current = void 0;
					installationsRequest.current = void 0;
					setInstallableLoading(false);
					setInstallableLoadingMore(false);
					setInstallationsLoading(false);
				} else {
					installableRequest.current?.abort();
					installationsRequest.current?.abort();
					installableRequest.current = void 0;
					installationsRequest.current = void 0;
					setInstallableLoading(false);
					setInstallationsLoading(false);
				}
			};
			const beginOperationPreview = async (requestValue) => {
				if (operationRequest.current !== void 0) return;
				const request = new AbortController();
				operationRequest.current = request;
				operationStage.current = "preview";
				setOperationPending(true);
				setOperationError(void 0);
				setOperationErrorDetailsValue(void 0);
				setOperationExecutionFailed(false);
				setDesktopActionError(void 0);
				setOperationSuccess(void 0);
				try {
					const preview = await previewMarketOperation(requestValue, request.signal);
					if (request.signal.aborted || operationRequest.current !== request) return;
					if (preview.action !== requestValue.action) throw new Error("operation preview action mismatch");
					setInstallationsUnavailable(false);
					setOperationPreview(preview);
				} catch (cause) {
					if (request.signal.aborted || operationRequest.current !== request) return;
					if (isDesktopUnavailable(cause)) {
						setInstallationsUnavailable(true);
						setInstallationsError(t("desktopUnavailable"));
						setOperationError(t("desktopUnavailable"));
					} else setOperationError(operationErrorMessage(cause, t(requestValue.action === "install" ? "previewError" : "uninstallPreviewError")));
				} finally {
					if (operationRequest.current === request) {
						operationRequest.current = void 0;
						operationStage.current = void 0;
						setOperationPending(false);
					}
				}
			};
			const openItem = (value) => {
				if (operationStage.current === "execute") return;
				if (operationStage.current === "preview") {
					operationRequest.current?.abort();
					operationRequest.current = void 0;
					operationStage.current = void 0;
					setOperationPending(false);
				}
				const selectionKey = visibleItemKey(value);
				selectedKeyRef.current = selectionKey;
				setSelected(value);
				setSelectedInstallation(void 0);
				setSelectedInventoryLoading(false);
				setSelectedInventoryError(void 0);
				setOperationPreview(void 0);
				setOperationSuccess(void 0);
				setOperationError(void 0);
				setOperationErrorDetailsValue(void 0);
				setOperationExecutionFailed(false);
				setDesktopActionError(void 0);
				const beginInstallPreview = () => {
					if (selectedKeyRef.current !== selectionKey) return;
					beginOperationPreview({
						action: "install",
						sourceRecordId: value.source.sourceRecordId,
						itemId: value.item.id
					});
				};
				if (value.item.package?.name === void 0) {
					beginInstallPreview();
					return;
				}
				const resolveInventory = (current) => {
					if (selectedKeyRef.current !== selectionKey) return;
					const installation = matchingInstallation(value, current);
					setSelectedInventoryLoading(false);
					if (installation !== void 0) setSelectedInstallation(installation);
					else beginInstallPreview();
				};
				if (installationsLoaded) {
					resolveInventory(installations);
					return;
				}
				setSelectedInventoryLoading(true);
				loadInstallations().then((outcome) => {
					if (selectedKeyRef.current !== selectionKey || outcome === void 0) return;
					if ("error" in outcome) {
						setSelectedInventoryLoading(false);
						setSelectedInventoryError(outcome.error);
						return;
					}
					resolveInventory(outcome.installations);
				});
			};
			const closeItem = () => {
				if (operationPending && operationPreview !== void 0) return;
				operationRequest.current?.abort();
				operationRequest.current = void 0;
				operationStage.current = void 0;
				desktopActionRequest.current?.abort();
				desktopActionRequest.current = void 0;
				setOperationPending(false);
				setDesktopActionPending(false);
				selectedKeyRef.current = void 0;
				setSelected(void 0);
				setSelectedInstallation(void 0);
				setSelectedInventoryLoading(false);
				setSelectedInventoryError(void 0);
				setOperationPreview(void 0);
				setOperationError(void 0);
				setOperationErrorDetailsValue(void 0);
				setOperationExecutionFailed(false);
				setDesktopActionError(void 0);
			};
			const executePreview = async () => {
				const preview = operationPreview;
				if (preview === void 0 || operationRequest.current !== void 0) return;
				const request = new AbortController();
				operationRequest.current = request;
				operationStage.current = "execute";
				setOperationPending(true);
				setOperationError(void 0);
				setOperationErrorDetailsValue(void 0);
				setOperationExecutionFailed(false);
				setDesktopActionError(void 0);
				try {
					const result = await executeMarketOperation(preview.previewId, request.signal);
					if (request.signal.aborted || operationRequest.current !== request) return;
					if (result.action !== preview.action) throw new Error("operation response action mismatch");
					setInstallations((current) => {
						if (result.action === "install") return current;
						return current.filter((installation) => installation.packageName !== result.packageName);
					});
					setInstallationsLoaded(true);
					setOperationPreview(void 0);
					selectedKeyRef.current = void 0;
					setSelected(void 0);
					setOperationSuccess({
						preview,
						restartToken: result.restartToken
					});
					if (result.action === "install" && viewRef.current === "installable") loadInstallable(false, appliedInstallableQuery, installableCategories);
					if (result.action === "uninstall" && viewRef.current === "installed") loadInstallations();
				} catch (cause) {
					if (request.signal.aborted || operationRequest.current !== request) return;
					setOperationExecutionFailed(true);
					setOperationErrorDetailsValue(operationErrorDetails(cause));
					if (isDesktopUnavailable(cause)) {
						setInstallationsUnavailable(true);
						setInstallationsError(t("desktopUnavailable"));
						setOperationError(t("desktopUnavailable"));
					} else setOperationError(operationErrorMessage(cause, t("executeError")));
				} finally {
					if (operationRequest.current === request) {
						operationRequest.current = void 0;
						operationStage.current = void 0;
						setOperationPending(false);
					}
				}
			};
			const runDesktopAction = async (action, restartToken) => {
				if (desktopActionRequest.current !== void 0) return;
				const request = new AbortController();
				desktopActionRequest.current = request;
				setDesktopActionPending(true);
				setDesktopActionError(void 0);
				try {
					if (action === "open-terminal") await openMarketTerminal(request.signal);
					else if (restartToken !== void 0) await requestMarketRestart(restartToken, request.signal);
					else throw new Error("restart token missing");
				} catch (cause) {
					if (request.signal.aborted || desktopActionRequest.current !== request) return;
					setDesktopActionError(t(isDesktopUnavailable(cause) ? "desktopActionUnavailable" : action === "open-terminal" ? "terminalError" : "restartError"));
				} finally {
					if (desktopActionRequest.current === request) {
						desktopActionRequest.current = void 0;
						setDesktopActionPending(false);
					}
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dshMarketRoot",
				"aria-label": t("title"),
				"aria-busy": loading || loadingMore || mutationPending || installationsLoading || operationPending || desktopActionPending,
				children: [
					showHeader && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
						className: "dshMarketHeader",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketHeaderTitle",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("subtitle") })]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketViewBar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketViewSwitch",
							role: "group",
							"aria-label": t("title"),
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
									active: view === "discover",
									"aria-pressed": view === "discover",
									onClick: () => selectMarketView("discover"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDataOutline16, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("discover") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
									active: view === "installable",
									"aria-pressed": view === "installable",
									onClick: () => selectMarketView("installable"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("installable") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
									active: view === "installed",
									"aria-pressed": view === "installed",
									onClick: () => selectMarketView("installed"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("installed") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
									active: view === "sources",
									"aria-pressed": view === "sources",
									onClick: () => selectMarketView("sources"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutline16, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("sources") })]
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
							className: "dshMarketCurrentSource",
							children: currentSource === void 0 ? t("noSourceSelected") : currentSourceHref === void 0 ? `${t("currentSource")}: ${currentSource.name}` : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								href: currentSourceHref,
								target: "_blank",
								rel: "noopener noreferrer",
								children: [
									t("currentSource"),
									": ",
									currentSource.name,
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutline16, { size: 12 })
								]
							})
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("main", {
						className: "dshMarketMain",
						children: view === "discover" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiscoverView, {
							state,
							items,
							metadata: catalog?.metadata,
							query,
							categoryOptions,
							selectedCategories,
							loading,
							loadingMore,
							mutationPending,
							error,
							loadMoreError,
							partialFailure,
							onQuery: setQuery,
							onSearch: () => state !== void 0 && void loadCatalog(state, query, selectedCategories),
							onRefresh: () => void loadState(appliedQuery, selectedCategories, true),
							onToggleCategory: toggleCategory,
							onLoadMore: () => {
								loadMore();
							},
							hasMore: pageTarget !== void 0,
							onSources: () => selectMarketView("sources"),
							onSelect: openItem,
							t
						}) : view === "installable" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallableView, {
							state,
							items: installableItems,
							totalItems: installableItems.length,
							query: installableQuery,
							categoryOptions: installableCategoryOptions,
							selectedCategories: installableCategories,
							metadata: installableIndex?.metadata,
							loaded: installableLoaded,
							loading: installableLoading,
							loadingMore: installableLoadingMore,
							hasMore: installableIndex?.nextCursor !== void 0,
							unavailable: installableUnavailable,
							error: installableError,
							operationPending,
							onQuery: setInstallableQuery,
							onSearch: () => {
								loadInstallable(false, installableQuery, installableCategories);
							},
							onRefresh: () => {
								loadInstallable(true, appliedInstallableQuery, installableCategories);
							},
							onToggleCategory: (category) => {
								const nextCategories = installableCategories.includes(category) ? installableCategories.filter((value) => value !== category) : [...installableCategories, category];
								loadInstallable(false, appliedInstallableQuery, nextCategories);
							},
							onLoadMore: () => {
								if (installableIndex?.nextCursor === void 0) return;
								loadInstallable(false, appliedInstallableQuery, installableCategories, {
									sourceRecordId: installableIndex.source.sourceRecordId,
									cursor: installableIndex.nextCursor
								});
							},
							onRetry: () => {
								loadInstallable(false, appliedInstallableQuery, installableCategories);
							},
							onSources: () => selectMarketView("sources"),
							onInstall: openItem,
							t
						}) : view === "installed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstalledView, {
							installations,
							loaded: installationsLoaded,
							loading: installationsLoading,
							unavailable: installationsUnavailable,
							error: installationsError ?? operationError,
							operationPending,
							onRetry: () => {
								loadInstallations();
							},
							onUninstall: (bundleId) => {
								beginOperationPreview({
									action: "uninstall",
									bundleId
								});
							},
							t
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourcesView, {
							state,
							catalog,
							error: mutationError,
							pending: mutationPending,
							adapterGuideHref: catalogAdapterGuideUrl(readLocale()),
							onMutation: (mutation) => {
								mutate(mutation);
							},
							onAddStandard: () => setAddOpen(true),
							t
						})
					}),
					selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ItemActionModal, {
						value: selected,
						installation: selectedInstallation,
						inventoryLoading: selectedInventoryLoading,
						inventoryError: selectedInventoryError,
						manualInstall: selectedManualInstall,
						preview: operationPreview?.action === "install" ? operationPreview : void 0,
						pending: operationPending,
						operationError,
						operationDetails: operationErrorDetailsValue,
						executionFailed: operationExecutionFailed,
						desktopActionError,
						desktopActionPending,
						canOpenTerminal: state?.desktopActions.openTerminal === true,
						verificationHelpHref: installRequirementsUrl(readLocale()),
						onClose: closeItem,
						onConfirm: () => {
							executePreview();
						},
						onOpenTerminal: () => {
							runDesktopAction("open-terminal");
						},
						onUninstall: (bundleId) => {
							selectedKeyRef.current = void 0;
							setSelected(void 0);
							setSelectedInstallation(void 0);
							beginOperationPreview({
								action: "uninstall",
								bundleId
							});
						},
						t
					}),
					selected === void 0 && operationPreview !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OperationConfirmModal, {
						preview: operationPreview,
						pending: operationPending,
						error: operationError,
						onCancel: () => {
							if (operationPending) return;
							setOperationPreview(void 0);
							setOperationError(void 0);
							setOperationErrorDetailsValue(void 0);
							setOperationExecutionFailed(false);
						},
						onConfirm: () => {
							executePreview();
						},
						t
					}),
					operationSuccess !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OperationSuccessModal, {
						operation: operationSuccess,
						canRestart: state?.desktopActions.requestRestart === true,
						pending: desktopActionPending,
						error: desktopActionError,
						onClose: () => setOperationSuccess(void 0),
						onRestart: () => {
							runDesktopAction("request-restart", operationSuccess.restartToken);
						},
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: addOpen,
						className: "dshMarketModal dshMarketSourceModal",
						contentClassName: "dshMarketModalContent",
						onClose: () => {
							if (!mutationPending) setAddOpen(false);
						},
						title: t("addStandard"),
						closeLabel: t("cancel"),
						description: t("sourceNotice"),
						footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketModalActions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								disabled: mutationPending,
								onClick: () => setAddOpen(false),
								children: t("cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "primary",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {}),
								disabled: mutationPending || !manifestUrl.trim(),
								onClick: () => {
									mutate({
										action: "add-standard",
										manifestUrl: manifestUrl.trim()
									}).then((succeeded) => {
										if (!succeeded) return;
										setManifestUrl("");
										setAddOpen(false);
									});
								},
								children: t("confirmAdd")
							})]
						}),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketModalField",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									htmlFor: "dsh-market-manifest",
									children: t("standardSource")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									id: "dsh-market-manifest",
									value: manifestUrl,
									disabled: mutationPending,
									placeholder: t("manifestPlaceholder"),
									onChange: (event) => setManifestUrl(event.currentTarget.value)
								}),
								mutationError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dshMarketError",
									role: "alert",
									children: mutationError
								})
							]
						})
					})
				]
			});
		}
		function MarketSettingsTab({ initialView, readLocale, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketSurface, {
				...initialView === void 0 ? {} : { initialView },
				readLocale,
				t
			});
		}
		function DiscoverView(props) {
			if (props.state !== void 0 && !props.state.sources.some((source) => source.enabled)) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketEmptyIcon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutline14, { size: 24 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("emptyTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("emptyBody") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutline16, {}),
						onClick: props.onSources,
						children: props.t("chooseSources")
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketContent",
				children: [
					props.metadata !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketIndexMeta",
						role: "status",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								props.t("scannedAt"),
								": ",
								props.metadata.scannedAt
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								props.t("cacheExpiresAt"),
								": ",
								props.metadata.expiresAt
							] }),
							props.metadata.providerRevision !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								props.t("providerRevision"),
								": ",
								props.metadata.providerRevision
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.metadata.cacheStatus === "fresh" ? props.t("freshScan") : props.t("cachedScan") })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: "dshMarketToolbar",
						onSubmit: (event) => {
							event.preventDefault();
							props.onSearch();
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: "dshMarketSearch",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, {}),
								value: props.query,
								disabled: props.mutationPending,
								placeholder: props.t("search"),
								onChange: (event) => props.onQuery(event.currentTarget.value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "submit",
								variant: "primary",
								disabled: props.mutationPending,
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, {}),
								children: props.t("searchAction")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: props.t("refresh"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									type: "button",
									size: "sm",
									variant: "toolbar",
									"aria-label": props.t("refresh"),
									disabled: props.loading || props.loadingMore || props.mutationPending,
									icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}),
									onClick: props.onRefresh
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: props.items.length })
						]
					}),
					props.categoryOptions.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketCategories",
						role: "group",
						"aria-label": props.t("categories"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.t("categories") }), props.categoryOptions.map((category) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
							active: props.selectedCategories.includes(category),
							"aria-pressed": props.selectedCategories.includes(category),
							disabled: props.mutationPending,
							onClick: () => props.onToggleCategory(category),
							children: category
						}, category))]
					}),
					props.partialFailure && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketBanner",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" }), props.t("partialFailure")]
					}),
					props.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketEmpty",
						role: "alert",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "error",
								size: 14
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("catalogError") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.error }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}),
								onClick: props.onRefresh,
								children: props.t("retry")
							})
						]
					}),
					props.error === void 0 && props.loading && props.items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketEmpty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
							state: "ongoing",
							size: 16
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("loading") })]
					}),
					props.error === void 0 && !props.loading && props.items.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketEmpty",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("noResults") })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketGrid",
						children: props.items.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginCard, {
							value,
							onClick: () => props.onSelect(value),
							t: props.t
						}, `${value.source.sourceRecordId}:${value.item.id}`))
					}),
					(props.hasMore || props.loadMoreError !== void 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketPagination",
						children: [props.loadMoreError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshMarketPaginationError",
							role: "status",
							children: props.loadMoreError
						}), props.hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "outline",
							disabled: props.loading || props.loadingMore || props.mutationPending,
							onClick: props.onLoadMore,
							children: props.loadingMore ? props.t("loadingMore") : props.t("loadMore")
						})]
					})
				]
			});
		}
		function InstallableView(props) {
			if (props.state !== void 0 && !props.state.sources.some((source) => source.enabled)) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketEmptyIcon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutline14, { size: 24 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("emptyTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("emptyBody") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutline16, {}),
						onClick: props.onSources,
						children: props.t("chooseSources")
					})
				]
			});
			if (props.unavailable) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				role: "status",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "warning",
						size: 16
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("desktopRequiredTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("desktopUnavailable") })
				]
			});
			if (props.loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
					state: "ongoing",
					size: 16
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("scanningInstallable") })]
			});
			if (!props.loaded && props.error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "error",
						size: 14
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("installableError") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}),
						onClick: props.onRetry,
						children: props.t("retry")
					})
				]
			});
			if (!props.loaded) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
					state: "ongoing",
					size: 16
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("scanningInstallable") })]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketContent",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketSectionHead",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("installable") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("installableBody") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							disabled: props.loading || props.operationPending,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}),
							onClick: props.onRefresh,
							children: props.t("rescanInstallable")
						})]
					}),
					props.metadata !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketIndexMeta",
						role: "status",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								props.t("scannedAt"),
								": ",
								props.metadata.scannedAt
							] }),
							props.metadata.providerRevision !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								props.t("providerRevision"),
								": ",
								props.metadata.providerRevision
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.metadata.cacheStatus === "fresh" ? props.t("freshScan") : props.t("cachedScan") })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
						className: "dshMarketToolbar",
						onSubmit: (event) => {
							event.preventDefault();
							props.onSearch();
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								className: "dshMarketSearch",
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, {}),
								value: props.query,
								disabled: props.operationPending,
								placeholder: props.t("search"),
								onChange: (event) => props.onQuery(event.currentTarget.value)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "submit",
								variant: "primary",
								disabled: props.operationPending,
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, {}),
								children: props.t("searchAction")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: props.totalItems })
						]
					}),
					props.categoryOptions.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketCategories",
						role: "group",
						"aria-label": props.t("categories"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.t("categories") }), props.categoryOptions.map((category) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
							active: props.selectedCategories.includes(category),
							"aria-pressed": props.selectedCategories.includes(category),
							disabled: props.operationPending,
							onClick: () => props.onToggleCategory(category),
							children: category
						}, category))]
					}),
					props.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketBanner",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.error })]
					}),
					props.items.length === 0 && !props.hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketEmpty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("noInstallable") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("noInstallableBody") })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketGrid",
						children: props.items.map((value) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginCard, {
							value,
							actionLabel: props.t("install"),
							disabled: props.operationPending,
							onClick: () => props.onInstall(value),
							t: props.t
						}, `${value.source.sourceRecordId}:${value.item.id}`))
					}),
					props.hasMore && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketPagination",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "outline",
							disabled: props.operationPending || props.loadingMore,
							onClick: props.onLoadMore,
							children: props.loadingMore ? props.t("loadingMore") : props.t("loadMore")
						})
					})
				]
			});
		}
		function InstalledView(props) {
			if (props.unavailable) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				role: "status",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "warning",
						size: 16
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("desktopRequiredTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("desktopUnavailable") })
				]
			});
			if (!props.loaded && props.loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
					state: "ongoing",
					size: 16
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("loadingInstallations") })]
			});
			if (!props.loaded && props.error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketEmpty",
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
						state: "error",
						size: 14
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("installationsError") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}),
						onClick: props.onRetry,
						children: props.t("retry")
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketContent",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketSectionHead",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("installed") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("installedBody") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							disabled: props.loading || props.operationPending,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}),
							onClick: props.onRetry,
							children: props.t("refresh")
						})]
					}),
					props.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketBanner",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), props.error]
					}),
					props.installations.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketEmpty",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: props.t("noInstalled") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.t("noInstalledBody") })]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketReceipts",
						children: props.installations.map((installation) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallationCard, {
							installation,
							operationPending: props.operationPending,
							onUninstall: props.onUninstall,
							t: props.t
						}, installation.bundleId))
					})
				]
			});
		}
		function InstallationCard(props) {
			const { installation } = props;
			const packageName = installation.packageName;
			const displayName = packageName;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("article", {
				className: "dshMarketReceipt",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketReceiptMain",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketReceiptTitle",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: installation.status === "disabled" ? "warning" : "done",
								size: 10
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: displayName }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: props.t("profileDependency") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: props.t(installation.status === "disabled" ? "disabledPlugin" : "activePlugin") })
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketReceiptMeta",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: packageName }), installation.status === "disabled" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.t("disabledRestartRequired") })]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dshMarketReceiptActions",
					children: installation.action === "uninstall" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						size: "sm",
						"aria-label": `${props.t("uninstall")}: ${displayName}`,
						disabled: props.operationPending,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),
						onClick: () => props.onUninstall(installation.bundleId),
						children: props.t("uninstall")
					})
				})]
			});
		}
		function sourceDisplayLabel(source) {
			const attribution = source.attribution?.name;
			return attribution === void 0 || attribution === source.name ? source.name : `${source.name} · ${attribution}`;
		}
		function safeHttpsExternalHref(value) {
			if (value === void 0) return void 0;
			try {
				const url = new URL(value);
				if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443") return;
				return url.href;
			} catch {
				return;
			}
		}
		function PluginCard({ value, actionLabel, disabled = false, onClick, t }) {
			const publisher = value.item.publisher?.name ?? value.source.name;
			const sourceLabel = sourceDisplayLabel(value.source);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dshMarketCard",
				"aria-haspopup": "dialog",
				"aria-label": actionLabel === void 0 ? void 0 : `${actionLabel}: ${value.item.displayName}`,
				disabled,
				onClick,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketCardTop",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginIcon, { item: value.item }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketCardName",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: value.item.displayName }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: publisher })]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dshMarketSummary",
						children: value.item.summary
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketTags",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: [
								t("source"),
								": ",
								sourceLabel
							] }),
							actionLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: actionLabel }),
							value.stale && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: t("stale") }),
							value.item.categories?.slice(0, 2).map((category) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: category }, category))
						]
					})
				]
			});
		}
		function SourceAttribution({ attribution }) {
			const href = safeHttpsExternalHref(attribution.url);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketSourceAttribution",
				children: [href === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: attribution.name }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					href,
					target: "_blank",
					rel: "noopener noreferrer",
					children: attribution.name
				}), attribution.notice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: attribution.notice })]
			});
		}
		function ItemSourceRow({ source, t }) {
			const label = sourceDisplayLabel(source);
			const href = safeHttpsExternalHref(source.homepage) ?? safeHttpsExternalHref(source.attribution?.url);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketItemSourceRow",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t("source"), ":"] }), href === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
					href,
					target: "_blank",
					rel: "noopener noreferrer",
					"aria-label": `${t("source")}: ${label}`,
					children: [
						label,
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutline16, { size: 12 })
					]
				})]
			});
		}
		function SourcesView({ state, catalog, error, pending, adapterGuideHref, onMutation, onAddStandard, t }) {
			const selectedKeys = new Set(state?.sources.map((source) => source.builtInProviderKey).filter(Boolean));
			const available = state?.builtIns.filter((provider) => !selectedKeys.has(provider.key)) ?? [];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketContent",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketSectionHead",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("sources") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("sourceNotice") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: pending,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {}),
							onClick: onAddStandard,
							children: t("addStandard")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketBanner dshMarketSourceGuide",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconGlobeOutline14, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							t("sourcePartnershipBefore"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: DSH_DESKTOP_ISSUES_URL,
								target: "_blank",
								rel: "noopener noreferrer",
								children: t("sourcePartnershipContact")
							}),
							t("sourcePartnershipAfter"),
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
								href: adapterGuideHref,
								target: "_blank",
								rel: "noopener noreferrer",
								children: t("sourcePartnershipGuide")
							})
						] })]
					}),
					error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketBanner",
						role: "alert",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" }), error]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketSources",
						role: "radiogroup",
						"aria-label": t("sourceSelection"),
						children: state?.sources.map((source, index, sources) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceRow, {
							source,
							result: catalog?.results.find((result) => result.source.sourceRecordId === source.sourceRecordId),
							pending,
							canMoveUp: index > 0,
							canMoveDown: index < sources.length - 1,
							onMoveUp: () => onMutation({
								action: "move",
								sourceRecordId: source.sourceRecordId,
								direction: "up"
							}),
							onMoveDown: () => onMutation({
								action: "move",
								sourceRecordId: source.sourceRecordId,
								direction: "down"
							}),
							onSelect: () => {
								if (!source.enabled) onMutation({
									action: "select",
									sourceRecordId: source.sourceRecordId
								});
							},
							onRemove: () => onMutation({
								action: "remove",
								sourceRecordId: source.sourceRecordId
							}),
							t
						}, source.sourceRecordId))
					}),
					available.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketSources dshMarketAvailableSources",
						children: available.map((provider) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AvailableSource, {
							provider,
							pending,
							onAdd: () => onMutation({
								action: "add-builtin",
								key: provider.key
							}),
							t
						}, provider.key))
					})
				]
			});
		}
		function SourceRow({ source, result, pending, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onSelect, onRemove, t }) {
			const endpointHost = (() => {
				try {
					return new URL(source.endpoint).host;
				} catch {
					return source.endpoint;
				}
			})();
			const resultLabel = result === void 0 ? t("notChecked") : result.error !== void 0 && result.snapshot === void 0 ? t("unavailable") : result.stale ? t("lastStale") : t("available");
			const resultState = result === void 0 ? "ongoing" : result.error !== void 0 && result.snapshot === void 0 ? "error" : result.stale ? "warning" : "done";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketSource",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", { children: [source.name, source.partnership && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: t("partner") })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: source.description ?? source.endpoint }),
					source.attribution !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceAttribution, { attribution: source.attribution }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshMarketSourceMeta",
						children: [
							source.attribution === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: source.providerId }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: endpointHost }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: source.registrationKind === "built-in" ? t("builtIn") : t("standardAdapter") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: resultState,
								size: 10
							}), resultLabel] })
						]
					})
				] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketSourceActions",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t("moveUp"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								variant: "ghost",
								size: "sm",
								"aria-label": t("moveUp"),
								disabled: pending || !canMoveUp,
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronUpOutline14, {}),
								onClick: onMoveUp
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t("moveDown"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								variant: "ghost",
								size: "sm",
								"aria-label": t("moveDown"),
								disabled: pending || !canMoveDown,
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {}),
								onClick: onMoveDown
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							size: "sm",
							role: "radio",
							"aria-checked": source.enabled,
							disabled: pending,
							icon: source.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, {}) : void 0,
							onClick: onSelect,
							children: source.enabled ? t("selectedSource") : t("selectSource")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t("remove"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								variant: "ghost",
								size: "sm",
								"aria-label": t("remove"),
								disabled: pending,
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),
								onClick: onRemove
							})
						})
					]
				})]
			});
		}
		function AvailableSource({ provider, pending, onAdd, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketSource",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", { children: [provider.name, provider.partnership && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, { children: t("partner") })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: provider.description }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SourceAttribution, { attribution: provider.attribution })
				] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: pending,
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {}),
					onClick: onAdd,
					children: t("add")
				})]
			});
		}
		function OperationFacts({ operation, showExpiry = true, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
				className: "dshMarketOperationFacts",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("plugin") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: operation.displayName })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("package") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: operation.packageName })] }),
					operation.version !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("exactVersion") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: operation.version })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("profile") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: operation.profileName })] }),
					showExpiry && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: t("previewExpires") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: operation.expiresAt })] })
				]
			});
		}
		function OperationConfirmModal({ preview, pending, error, onCancel, onConfirm, t }) {
			const installing = preview.action === "install";
			const title = installing ? t("confirmInstallTitle") : t("confirmUninstallTitle");
			const description = installing ? t("confirmInstallBody") : t("confirmUninstallBody");
			const confirmLabel = pending ? installing ? t("installing") : t("uninstalling") : installing ? t("confirmInstall") : t("confirmUninstall");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				className: "dshMarketModal dshMarketConfirmModal",
				contentClassName: "dshMarketModalContent",
				onClose: onCancel,
				closeLabel: t("cancel"),
				title,
				description,
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketModalActions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						disabled: pending,
						onClick: onCancel,
						children: t("cancel")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: pending,
						icon: installing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),
						onClick: onConfirm,
						children: confirmLabel
					})]
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketOperationReview",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OperationFacts, {
							operation: preview,
							t
						}),
						installing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationWarning",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "warning",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("operationWarning") })]
						}),
						installing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationWarning",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "warning",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("operationRiskBeforeContact"),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									href: DSH_DESKTOP_ISSUES_URL,
									target: "_blank",
									rel: "noopener noreferrer",
									children: t("contactUs")
								}),
								t("operationRiskAfterContact")
							] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationWarning",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "warning",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("restartAfterOperation") })]
						}),
						pending && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationProgress",
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "ongoing",
								size: 12
							}), confirmLabel]
						}),
						error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshMarketError",
							role: "alert",
							children: error
						})
					]
				})
			});
		}
		function OperationSuccessModal({ operation, canRestart, pending, error, onClose, onRestart, t }) {
			const title = operation.preview.action === "install" ? t("installComplete") : t("uninstallComplete");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				className: "dshMarketModal dshMarketStatusModal",
				contentClassName: "dshMarketModalContent",
				onClose: () => {
					if (!pending) onClose();
				},
				closeLabel: t("close"),
				title,
				description: t("restartRequiredTitle"),
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketModalActions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						disabled: pending,
						onClick: onClose,
						children: t("restartLater")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: !canRestart || pending,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}),
						onClick: onRestart,
						children: pending ? t("restarting") : t("restartNow")
					})]
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketOperationReview",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OperationFacts, {
							operation: operation.preview,
							showExpiry: false,
							t
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationSuccess",
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "done",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("restartRequiredBody") })]
						}),
						error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshMarketError",
							role: "alert",
							children: error
						})
					]
				})
			});
		}
		function ItemActionModal({ value, installation, inventoryLoading, inventoryError, manualInstall, preview, pending, operationError, operationDetails, executionFailed, desktopActionError, desktopActionPending, canOpenTerminal, verificationHelpHref, onClose, onConfirm, onOpenTerminal, onUninstall, t }) {
			const checking = preview === void 0 && pending && operationError === void 0;
			const failureInstallCommand = preview === void 0 ? void 0 : preview.version === void 0 ? `dsh plugin add ${preview.packageName}` : `dsh plugin add --save-exact ${preview.packageName}@${preview.version}`;
			const footer = executionFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [canOpenTerminal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				disabled: desktopActionPending,
				onClick: onOpenTerminal,
				children: desktopActionPending ? t("openingTerminal") : t("openTerminal")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				disabled: desktopActionPending,
				onClick: onClose,
				children: t("close")
			})] }) : installation === void 0 && preview !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				disabled: pending,
				onClick: onClose,
				children: t("cancel")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				disabled: pending,
				icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutline16, {}),
				onClick: onConfirm,
				children: pending ? t("installing") : t("confirmInstall")
			})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				value.item.repository !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutline16, { size: 12 }),
					onClick: () => window.open(value.item.repository.url, "_blank", "noopener,noreferrer"),
					children: t("repository")
				}),
				installation === void 0 && !inventoryLoading && inventoryError === void 0 && manualInstall !== void 0 && canOpenTerminal && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					disabled: desktopActionPending,
					onClick: onOpenTerminal,
					children: desktopActionPending ? t("openingTerminal") : t("openTerminal")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					disabled: desktopActionPending,
					onClick: onClose,
					children: t("close")
				})
			] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				className: "dshMarketModal dshMarketWideModal",
				contentClassName: "dshMarketModalContent",
				onClose,
				title: executionFailed ? t("installFailedTitle") : preview === void 0 ? value.item.displayName : t("confirmInstallTitle"),
				closeLabel: t("close"),
				...executionFailed ? { description: t("installFailedBody") } : preview === void 0 ? {} : { description: t("confirmInstallBody") },
				footer: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dshMarketModalActions",
					children: footer
				}),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ItemSourceRow, {
					source: value.source,
					t
				}), preview !== void 0 && executionFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketOperationReview",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OperationFacts, {
							operation: preview,
							showExpiry: false,
							t
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketFailureSummary",
							role: "alert",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "error",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: operationError ?? t("executeError") })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationWarning",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "warning",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("installFailureTerminalHint") })]
						}),
						failureInstallCommand !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketCommand",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("installCommand") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: failureInstallCommand })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketFailureOutput",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("failureOutput") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: operationDetails ?? t("noFailureOutput") })]
						}),
						desktopActionError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshMarketError",
							role: "alert",
							children: desktopActionError
						})
					]
				}) : preview !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketOperationReview",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(OperationFacts, {
							operation: preview,
							t
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationWarning",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "warning",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("operationWarning") })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationWarning",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "warning",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
								t("operationRiskBeforeContact"),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
									href: DSH_DESKTOP_ISSUES_URL,
									target: "_blank",
									rel: "noopener noreferrer",
									children: t("contactUs")
								}),
								t("operationRiskAfterContact")
							] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationWarning",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "warning",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("restartAfterOperation") })]
						}),
						pending && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationProgress",
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "ongoing",
								size: 12
							}), t("installing")]
						}),
						operationError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshMarketError",
							role: "alert",
							children: operationError
						})
					]
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshMarketDetails",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketDetailsIntro",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PluginIcon, {
								item: value.item,
								large: true
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: value.item.description ?? value.item.summary })]
						}),
						inventoryLoading && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationProgress",
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "ongoing",
								size: 12
							}), t("loadingInstallations")]
						}),
						inventoryError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketBanner",
							role: "alert",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: inventoryError })]
						}),
						installation !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshMarketReceipts",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstallationCard, {
								installation,
								operationPending: pending,
								onUninstall,
								t
							})
						}),
						!inventoryLoading && inventoryError === void 0 && installation === void 0 && checking && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketOperationProgress",
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "ongoing",
								size: 12
							}), t("checkingInstallMethod")]
						}),
						installation === void 0 && !inventoryLoading && !checking && operationError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketBanner",
							role: "alert",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: operationError }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
									href: verificationHelpHref,
									target: "_blank",
									rel: "noopener noreferrer",
									children: [
										t("verificationDetails"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutline16, { size: 12 })
									]
								})
							]
						}),
						installation === void 0 && !inventoryLoading && inventoryError === void 0 && !checking && manualInstall !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshMarketManualInstall",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("manualInstallTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("manualInstallBody") })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshMarketCommand",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("installCommand") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: manualInstall.displayCommand })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshMarketOperationWarning",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
										state: "warning",
										size: 12
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("manualNotVerified") })]
								}),
								manualInstall.mutable && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshMarketOperationWarning",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
										state: "warning",
										size: 12
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("mutableGithubWarning") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshMarketOperationWarning",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
										state: "warning",
										size: 12
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("operationWarning") })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dshMarketOperationWarning",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
										state: "warning",
										size: 12
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										t("operationRiskBeforeContact"),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
											href: DSH_DESKTOP_ISSUES_URL,
											target: "_blank",
											rel: "noopener noreferrer",
											children: t("contactUs")
										}),
										t("operationRiskAfterContact")
									] })]
								})
							]
						}) : installation === void 0 && !inventoryLoading && inventoryError === void 0 && !checking && operationError === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: t("readOnly") }) : null,
						desktopActionError !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshMarketError",
							role: "alert",
							children: desktopActionError
						})
					]
				})] })
			});
		}
		//#endregion
		//#region src/client/MarketOverlay.tsx
		function MarketOverlay({ useStore, actions, readLocale, t, initialView }) {
			const open = useStore((state) => state.open);
			const panel = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				panel.current?.querySelector("button")?.focus();
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					if (document.querySelectorAll("[role=\"dialog\"]").length > 1) return;
					actions.close();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [actions, open]);
			if (!open) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshMarketOverlay",
				role: "dialog",
				"aria-modal": "true",
				"aria-label": t("title"),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: "dshMarketOverlayMask",
					type: "button",
					"aria-label": t("closeMarket"),
					onClick: () => actions.close()
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					ref: panel,
					className: "dshMarketOverlayPanel",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dshMarketOverlayHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: t("title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("subtitle") })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t("closeMarket"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "ghost",
								size: "sm",
								"aria-label": t("closeMarket"),
								icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, {}),
								onClick: () => actions.close()
							})
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dshMarketOverlayBody",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarketSurface, {
							...initialView === void 0 ? {} : { initialView },
							readLocale,
							showHeader: false,
							t
						})
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/market-view-store.ts
		function createMarketViewStore() {
			return (0, _deepseek_ai_dsh_client_store.defineStore)({
				init: () => ({ open: false }),
				actions: {
					open: (draft) => {
						draft.open = true;
					},
					close: (draft) => {
						draft.open = false;
					}
				}
			});
		}
		//#endregion
		//#region src/client/locales.ts
		const zh = {
			tab: "插件市场",
			title: "社区插件市场",
			subtitle: "从你选择的来源发现 DeepSeek Harness 插件",
			close: "关闭",
			closeMarket: "关闭插件市场",
			discover: "发现",
			installable: "可安装",
			installed: "已安装",
			sources: "来源",
			sourceSelection: "选择插件来源",
			currentSource: "当前来源",
			noSourceSelected: "未选择来源",
			search: "搜索插件",
			searchAction: "搜索",
			categories: "分类",
			refresh: "刷新",
			loading: "正在加载插件目录...",
			emptyTitle: "尚未选择来源",
			emptyBody: "你可以添加多个来源，但每次只能使用一个。",
			chooseSources: "管理来源",
			noResults: "没有找到匹配的插件",
			loadMore: "加载更多",
			loadingMore: "正在加载更多...",
			loadMoreError: "无法加载更多，已显示的结果不受影响。",
			partialFailure: "当前来源刷新失败，正在显示上次成功加载的结果。",
			stale: "上次结果",
			source: "来源",
			repository: "打开源码仓库",
			details: "插件详情",
			readOnly: "暂不支持在桌面端自动安装此插件。你仍可查看插件信息和源码仓库。",
			checkingInstallMethod: "正在确认可用的安装方式...",
			manualInstallTitle: "手动安装",
			manualInstallBody: "以下命令由 DSH Desktop 根据插件信息生成，可能与仓库中的说明不同。请先检查源码，再复制到 DSH 终端执行。",
			installCommand: "安装命令",
			manualNotVerified: "这条展示命令没有通过桌面端自动安装所需的完整包验证，请自行确认插件来源、内容和兼容性。",
			mutableGithubWarning: "GitHub 安装指向仓库当前 HEAD，内容可能随时变化，无法锁定到本次看到的代码。",
			openTerminal: "打开 DSH 终端",
			openingTerminal: "正在打开终端...",
			desktopActionUnavailable: "当前环境不支持这个桌面操作。",
			terminalError: "无法打开 DSH 终端，请从应用菜单手动打开后再复制命令。",
			restartError: "无法请求重启 DSH Desktop，请稍后手动重启。",
			installableBody: "这里显示当前来源中提供 npm 安装目标的插件。安装前会从 npm 获取最新稳定版并确认它是 DSH 插件。",
			installedBody: "这里显示当前 Profile 的直接插件依赖，包括通过其他插件市场或命令行安装的插件。可卸载的插件只提供卸载操作。",
			install: "安装",
			uninstall: "卸载",
			managedPlugin: "通过插件市场安装",
			externalPlugin: "通过其他方式安装",
			profileDependency: "Profile 直接依赖",
			immutablePlugin: "DSH 核心组件",
			activePlugin: "当前已加载",
			disabledPlugin: "当前未加载",
			noInstallable: "当前来源没有可自动安装的插件",
			noInstallableBody: "其他插件仍可在“发现”页面查看。",
			scanningInstallable: "正在检查可安装插件...",
			installableError: "暂时无法加载可安装插件",
			rescanInstallable: "重新检查",
			scannedAt: "目录更新于",
			cacheExpiresAt: "缓存有效期至",
			providerRevision: "来源版本",
			freshScan: "最新数据",
			cachedScan: "缓存数据",
			noInstalled: "当前配置没有可管理的插件",
			noInstalledBody: "当前配置中没有可显示的插件。",
			loadingInstallations: "正在读取当前配置中的插件...",
			desktopRequiredTitle: "需要 DSH Desktop",
			desktopUnavailable: "安装和卸载只在 DSH Desktop 中可用；你仍然可以浏览插件目录。",
			installationsError: "暂时无法读取当前配置的插件清单",
			previewError: "无法验证这个插件的精确目标，可能并非标准插件。",
			verificationDetails: "查看详情",
			uninstallPreviewError: "无法确认此插件仍是当前 Profile 的可卸载直接依赖，请刷新后重试。",
			executeError: "无法确认操作结果。请先刷新“已安装”后重试，避免重复操作。",
			installFailedTitle: "插件安装失败",
			installFailedBody: "DSH Desktop 未能完成自动安装。你可以查看详细输出，或前往 DSH 终端手动安装。",
			installFailureTerminalHint: "自动安装失败后不会再次使用同一个确认请求。请检查下面的输出；如需继续，可以打开 DSH 终端并手动执行安装命令。",
			failureOutput: "详细输出",
			noFailureOutput: "没有收到 package manager 的额外输出。请查看 DSH Desktop 日志了解更多信息。",
			plugin: "插件",
			package: "npm 包",
			exactVersion: "精确版本",
			profile: "当前配置",
			installedAt: "安装时间",
			previewExpires: "确认有效期至",
			confirmInstallTitle: "确认安装插件",
			confirmInstallBody: "请确认 DSH Desktop 验证的 npm 包、版本和目标配置。",
			confirmUninstallTitle: "确认卸载插件",
			confirmUninstallBody: "将从当前 Profile 中卸载这个直接插件依赖，无论它最初通过哪个插件市场或命令行安装。",
			confirmInstall: "确认安装",
			confirmUninstall: "确认卸载",
			installing: "正在安装...",
			uninstalling: "正在卸载...",
			operationWarning: "插件会作为本地代码，以你的用户权限运行。请只安装你信任的插件。",
			operationRiskBeforeContact: "以错误方式安装插件，或者安装未经验证的插件，可能导致软件崩溃或异常。你可以",
			contactUs: "联系我们",
			operationRiskAfterContact: "，或者联系插件开发者。",
			restartAfterOperation: "操作完成后需要重启 DSH Desktop，改动才会生效。",
			disabledRestartRequired: "此插件保留了未加载状态；插件市场仍只提供卸载。",
			installComplete: "插件安装完成",
			uninstallComplete: "插件卸载完成",
			restartRequiredTitle: "需要重启 DSH Desktop",
			restartRequiredBody: "请重启 DSH Desktop，让当前配置加载最新的插件状态。",
			restartLater: "稍后重启",
			restartNow: "立即重启",
			restarting: "正在重启...",
			done: "完成",
			builtIn: "内置适配器",
			partner: "合作提供方",
			sourcePartnershipBefore: "除了添加符合接入格式的自定义来源，也可以",
			sourcePartnershipContact: "联系我们",
			sourcePartnershipAfter: "，申请将你的插件市场加入内置合作来源。",
			sourcePartnershipGuide: "查看来源接入指南",
			selectSource: "选择此来源",
			selectedSource: "当前来源",
			add: "添加",
			remove: "移除来源",
			moveUp: "上移来源",
			moveDown: "下移来源",
			standardSource: "来源清单 URL",
			standardAdapter: "标准协议",
			notChecked: "尚未检查",
			available: "最近检查可用",
			lastStale: "正在使用旧数据",
			unavailable: "最近检查不可用",
			manifestPlaceholder: "https://example.com/catalog-source.json",
			addStandard: "添加标准来源",
			cancel: "取消",
			confirmAdd: "添加来源",
			sourceNotice: "可以添加多个来源，但每次只使用一个。请使用您信任的插件来源。",
			sourceError: "来源操作失败",
			catalogError: "暂时无法加载插件目录",
			catalogFailureSource: "来源",
			catalogFailureTimeout: "目录请求超时。",
			catalogFailureInvalidResponse: "来源返回了无法识别的目录数据。",
			catalogFailureUnavailable: "当前无法连接该目录来源。",
			retry: "重试"
		};
		const en = {
			tab: "Plugin Market",
			title: "Community Plugin Market",
			subtitle: "Discover DeepSeek Harness plugins from sources you choose",
			close: "Close",
			closeMarket: "Close Plugin Market",
			discover: "Discover",
			installable: "Installable",
			installed: "Installed",
			sources: "Sources",
			sourceSelection: "Choose plugin source",
			currentSource: "Current source",
			noSourceSelected: "No source selected",
			search: "Search plugins",
			searchAction: "Search",
			categories: "Categories",
			refresh: "Refresh",
			loading: "Loading plugin catalog...",
			emptyTitle: "No source selected",
			emptyBody: "You can add multiple sources, but only one is used at a time.",
			chooseSources: "Manage sources",
			noResults: "No matching plugins",
			loadMore: "Load more",
			loadingMore: "Loading more...",
			loadMoreError: "More results could not be loaded. Results already shown are unaffected.",
			partialFailure: "The current source could not be refreshed. Showing the last successfully loaded results.",
			stale: "Previous results",
			source: "Source",
			repository: "Open source repository",
			details: "Plugin details",
			readOnly: "This plugin cannot currently be installed automatically in Desktop. You can still review its details and source repository.",
			checkingInstallMethod: "Checking available installation methods...",
			manualInstallTitle: "Manual installation",
			manualInstallBody: "DSH Desktop generated this command from the plugin information, so it may differ from the repository instructions. Review the source first, then copy it into DSH Terminal.",
			installCommand: "Install command",
			manualNotVerified: "This display-only command has not passed the complete package verification required for managed installation. Verify the source, contents, and compatibility yourself.",
			mutableGithubWarning: "This GitHub target follows the repository’s current HEAD. Its contents can change and are not pinned to the code shown now.",
			openTerminal: "Open DSH Terminal",
			openingTerminal: "Opening terminal...",
			desktopActionUnavailable: "This desktop action is not available in the current environment.",
			terminalError: "DSH Terminal could not be opened. Open it from the application menu, then copy the command manually.",
			restartError: "DSH Desktop could not be restarted. Restart it manually when convenient.",
			installableBody: "This view shows source entries with an npm install target. Before installation, Desktop resolves npm latest and confirms that it is a DSH plugin.",
			installedBody: "Direct plugin dependencies in the active Profile appear here, including plugins installed by other markets or the CLI. Removable plugins offer uninstall only.",
			install: "Install",
			uninstall: "Uninstall",
			managedPlugin: "Installed by Plugin Market",
			externalPlugin: "Installed another way",
			profileDependency: "Direct Profile dependency",
			immutablePlugin: "DSH core component",
			activePlugin: "Currently loaded",
			disabledPlugin: "Currently not loaded",
			noInstallable: "No automatically installable plugins in the current source",
			noInstallableBody: "Other plugins remain available under Discover.",
			scanningInstallable: "Checking installable plugins...",
			installableError: "Installable plugins are temporarily unavailable",
			rescanInstallable: "Check again",
			scannedAt: "Catalog updated",
			cacheExpiresAt: "Cache expires",
			providerRevision: "Provider revision",
			freshScan: "Fresh data",
			cachedScan: "Cached data",
			noInstalled: "No manageable plugins in the current profile",
			noInstalledBody: "There are no plugins to show in the active profile.",
			loadingInstallations: "Reading plugins in the active profile...",
			desktopRequiredTitle: "DSH Desktop is required",
			desktopUnavailable: "Install and uninstall are available only in DSH Desktop. You can still browse the catalog.",
			installationsError: "The plugin inventory for the current profile is temporarily unavailable",
			previewError: "The exact plugin target could not be verified and may not be a standard plugin.",
			verificationDetails: "View details",
			uninstallPreviewError: "This plugin is no longer a removable direct dependency of the active Profile. Refresh and try again.",
			executeError: "The operation result could not be confirmed. Refresh Installed before trying again to avoid repeating the operation.",
			installFailedTitle: "Plugin installation failed",
			installFailedBody: "DSH Desktop could not complete the automatic installation. Review the detailed output or continue manually in DSH Terminal.",
			installFailureTerminalHint: "Desktop will not reuse the same confirmation after a failed automatic install. Review the output below; to continue, open DSH Terminal and run the install command manually.",
			failureOutput: "Detailed output",
			noFailureOutput: "The package manager returned no additional output. Check the DSH Desktop logs for more information.",
			plugin: "Plugin",
			package: "npm package",
			exactVersion: "Exact version",
			profile: "Current profile",
			installedAt: "Installed at",
			previewExpires: "Confirmation expires",
			confirmInstallTitle: "Confirm plugin installation",
			confirmInstallBody: "Review the npm package, version, and target profile verified by DSH Desktop.",
			confirmUninstallTitle: "Confirm plugin removal",
			confirmUninstallBody: "This direct plugin dependency will be removed from the active Profile, regardless of which market or CLI originally installed it.",
			confirmInstall: "Confirm install",
			confirmUninstall: "Confirm uninstall",
			installing: "Installing...",
			uninstalling: "Uninstalling...",
			operationWarning: "Plugins run as local code with your user permissions. Install only plugins you trust.",
			operationRiskBeforeContact: "Installing a plugin incorrectly, or installing an unverified plugin, may cause crashes or unexpected behavior. You can ",
			contactUs: "contact us",
			operationRiskAfterContact: " or the plugin developer.",
			restartAfterOperation: "Restart DSH Desktop after this operation for the change to take effect.",
			disabledRestartRequired: "This plugin retains a not-loaded state; Plugin Market still offers uninstall only.",
			installComplete: "Plugin installed",
			uninstallComplete: "Plugin uninstalled",
			restartRequiredTitle: "Restart DSH Desktop",
			restartRequiredBody: "Restart DSH Desktop so the current profile loads its updated plugin state.",
			restartLater: "Restart later",
			restartNow: "Restart now",
			restarting: "Restarting...",
			done: "Done",
			builtIn: "Built-in adapter",
			partner: "Partner provider",
			sourcePartnershipBefore: "Besides adding a compatible custom source, you can ",
			sourcePartnershipContact: "contact us",
			sourcePartnershipAfter: " to apply for inclusion as a built-in partner source.",
			sourcePartnershipGuide: "Read the source integration guide",
			selectSource: "Select this source",
			selectedSource: "Current source",
			add: "Add",
			remove: "Remove source",
			moveUp: "Move source up",
			moveDown: "Move source down",
			standardSource: "Source manifest URL",
			standardAdapter: "Standard protocol",
			notChecked: "Not checked yet",
			available: "Available on last check",
			lastStale: "Using stale data",
			unavailable: "Unavailable on last check",
			manifestPlaceholder: "https://example.com/catalog-source.json",
			addStandard: "Add standard source",
			cancel: "Cancel",
			confirmAdd: "Add source",
			sourceNotice: "You can add multiple sources, but only one is used at a time. Use only plugin sources you trust.",
			sourceError: "Source operation failed",
			catalogError: "The plugin catalog is temporarily unavailable",
			catalogFailureSource: "Source",
			catalogFailureTimeout: "The catalog request timed out.",
			catalogFailureInvalidResponse: "The source returned catalog data that could not be read.",
			catalogFailureUnavailable: "The catalog source could not be reached.",
			retry: "Retry"
		};
		//#endregion
		//#region src/client/styles.ts
		const STYLE_ID = "dsh-community-market/styles";
		const css = `
.dshMarketRoot {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 460px;
  color: var(--dsw-alias-label-primary);
}

.dshMarketHeader,
.dshMarketViewBar,
.dshMarketSectionHead,
.dshMarketToolbar,
.dshMarketSourceActions,
.dshMarketOverlayHeader {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dshMarketHeader,
.dshMarketSectionHead,
.dshMarketOverlayHeader {
  align-items: flex-start;
}

.dshMarketHeaderTitle,
.dshMarketSectionHead > div,
.dshMarketOverlayHeader > div {
  min-width: 0;
  flex: 1;
}

.dshMarketHeaderTitle h2,
.dshMarketSectionHead h2,
.dshMarketOverlayHeader h1 {
  margin: 0;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.dshMarketHeaderTitle p,
.dshMarketSectionHead p,
.dshMarketOverlayHeader p {
  margin: 3px 0 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.dshMarketViewBar {
  justify-content: space-between;
}

.dshMarketViewSwitch {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.dshMarketCurrentSource a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: inherit;
  text-decoration: none;
}

.dshMarketCurrentSource a:hover {
  text-decoration: underline;
}

.dshMarketMain,
.dshMarketContent {
  min-width: 0;
}

.dshMarketToolbar {
  margin-bottom: 16px;
}

.dshMarketCategories {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: -4px 0 16px;
}

.dshMarketCategories > span:first-child {
  margin-right: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dshMarketSearch {
  min-width: 220px;
  flex: 1;
}

.dshMarketBanner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}

.dshMarketSourceGuide {
  align-items: flex-start;
}

.dshMarketSourceGuide > span {
  min-width: 0;
}

.dshMarketGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.dshMarketCard {
  appearance: none;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 150px;
  padding: 15px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.dshMarketCard:hover {
  border-color: var(--dsw-alias-border-l3);
  background: var(--dsw-alias-interactive-bg-hover);
  box-shadow: var(--dsw-shadow-lv1);
}

.dshMarketCard:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dshMarketCard:disabled {
  cursor: not-allowed;
  opacity: 0.62;
  box-shadow: none;
}

.dshMarketCardTop {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.dshMarketGlyph,
.dshMarketEmptyIcon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--dsw-alias-state-business-tertiary);
  color: var(--dsw-alias-state-business-primary);
}

.dshMarketGlyph {
  position: relative;
  overflow: hidden;
  width: 34px;
  height: 34px;
}

.dshMarketGlyphLarge {
  width: 56px;
  height: 56px;
  border-radius: 12px;
}

.dshMarketGlyph img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: var(--dsw-alias-bg-layer-3);
}

.dshMarketCardName {
  min-width: 0;
  flex: 1;
}

.dshMarketCardName strong,
.dshMarketCardName span {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dshMarketCardName strong {
  font-size: 14px;
  line-height: 20px;
}

.dshMarketCardName span {
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 17px;
}

.dshMarketSummary {
  display: -webkit-box;
  margin: 12px 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 19px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.dshMarketTags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: auto;
  overflow: hidden;
}

.dshMarketPagination {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 18px 0 4px;
}

.dshMarketPaginationError {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.dshMarketEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  padding: 24px;
  text-align: center;
}

.dshMarketEmptyIcon {
  width: 48px;
  height: 48px;
  margin-bottom: 14px;
}

.dshMarketEmpty h2 {
  margin: 0 0 6px;
  font-size: 16px;
  line-height: 23px;
}

.dshMarketEmpty p {
  max-width: 430px;
  margin: 0 0 16px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.dshMarketSectionHead {
  margin-bottom: 16px;
}

.dshMarketIndexMeta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: -6px 0 14px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dshMarketSources {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.dshMarketAvailableSources {
  margin-top: 9px;
}

.dshMarketSource {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3);
}

.dshMarketSource h3 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  margin: 0;
  font-size: 14px;
  line-height: 20px;
}

.dshMarketSource p {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dshMarketSourceAttribution {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 7px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dshMarketSourceAttribution a {
  color: var(--dsw-alias-label-secondary);
  text-decoration: underline;
  text-decoration-color: var(--dsw-alias-border-l3);
  text-underline-offset: 2px;
}

.dshMarketSourceAttribution a:hover {
  color: var(--dsw-alias-label-primary);
}

.dshMarketSourceMeta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px 10px;
  margin-top: 7px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}

.dshMarketSourceMeta > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  overflow-wrap: anywhere;
}

.dshMarketSourceActions {
  justify-content: flex-end;
  gap: 7px;
}

.dshMarketReceipts {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.dshMarketReceipt {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3);
}

.dshMarketReceiptMain {
  min-width: 0;
}

.dshMarketReceiptActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.dshMarketReceiptTitle,
.dshMarketReceiptMeta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.dshMarketReceiptTitle {
  gap: 7px;
}

.dshMarketReceiptTitle h3 {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
}

.dshMarketReceiptMeta {
  gap: 5px 12px;
  margin-top: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dshMarketReceiptMeta span {
  overflow-wrap: anywhere;
}

.dshMarketDetails {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dshMarketItemSourceRow {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  margin-bottom: 14px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  text-align: right;
}

.dshMarketItemSourceRow > :last-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dshMarketItemSourceRow a {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 3px;
  color: var(--dsw-alias-label-secondary);
  text-decoration: underline;
  text-decoration-color: var(--dsw-alias-border-l3);
  text-underline-offset: 2px;
}

.dshMarketItemSourceRow a:hover {
  color: var(--dsw-alias-label-primary);
}

.dshMarketDetailsIntro {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.dshMarketDetailsIntro > p {
  min-width: 0;
  flex: 1;
}

.dshMarketDetails p {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
}

.dshMarketDetails > div:last-child {
  padding-top: 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 19px;
}

.dshMarketManualInstall {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dshMarketModal {
  max-height: calc(100vh - 48px);
  max-height: calc(100dvh - 48px);
}

.dshMarketWideModal {
  width: min(800px, calc(100vw - 48px));
}

.dshMarketConfirmModal {
  width: min(600px, calc(100vw - 48px));
}

.dshMarketSourceModal {
  width: min(600px, calc(100vw - 48px));
}

.dshMarketStatusModal {
  width: min(480px, calc(100vw - 48px));
}

.dshMarketModalContent {
  min-height: 0;
  overflow-y: auto;
}

.dshMarketModalActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.dshMarketManualInstall h3 {
  margin: 0 0 3px;
  font-size: 14px;
  line-height: 20px;
}

.dshMarketManualInstall p {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 19px;
}

.dshMarketCommand {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dshMarketCommand > span {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dshMarketCommand code {
  display: block;
  overflow-x: auto;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 12px;
  line-height: 19px;
  white-space: pre;
}

.dshMarketOperationReview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dshMarketOperationFacts {
  display: grid;
  gap: 8px;
  margin: 0;
}

.dshMarketOperationFacts > div {
  display: grid;
  grid-template-columns: minmax(105px, 0.36fr) minmax(0, 1fr);
  gap: 12px;
}

.dshMarketOperationFacts dt,
.dshMarketOperationFacts dd {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
}

.dshMarketOperationFacts dt {
  color: var(--dsw-alias-label-tertiary);
}

.dshMarketOperationFacts dd {
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

.dshMarketOperationWarning,
.dshMarketOperationSuccess,
.dshMarketOperationProgress {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 19px;
}

.dshMarketOperationSuccess {
  color: var(--dsw-alias-label-primary);
}

.dshMarketFailureSummary {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 19px;
}

.dshMarketFailureOutput {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dshMarketFailureOutput > span {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dshMarketFailureOutput pre {
  box-sizing: border-box;
  max-height: 260px;
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 11px;
  line-height: 18px;
  overflow-wrap: normal;
  white-space: pre-wrap;
}

.dshMarketModalField {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dshMarketModalField label {
  font-size: 13px;
  font-weight: 600;
}

.dshMarketError {
  margin-top: 8px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}

.dshMarketLauncher {
  flex: none;
  box-sizing: border-box;
  width: calc(100% + 4px);
  height: 42px;
  margin: 4px -2px;
  padding: 0 10px 0 8px;
  gap: 8px;
  justify-content: flex-start;
  overflow: hidden;
  border-radius: 12px;
  white-space: nowrap;
}

.dshMarketLauncher[data-wide='false'] {
  width: 36px;
  height: 36px;
  margin: 8px 0 10px;
  justify-content: center;
  gap: 0;
  padding: 0;
  border-radius: 50%;
}

.dshMarketOverlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  pointer-events: auto;
}

.dshMarketOverlayMask {
  position: absolute;
  inset: 0;
  border: 0;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
}

.dshMarketOverlayPanel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(800px, 100%);
  height: min(700px, 100%);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-inverted);
  border-radius: 24px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-shadow-lv3);
}

.dshMarketOverlayHeader {
  flex: none;
  padding: 20px 18px 14px 24px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}

.dshMarketOverlayBody {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 20px 24px 24px;
}

@media (max-width: 680px) {
  .dshMarketOverlay {
    padding: 0;
  }

  .dshMarketOverlayPanel {
    width: 100%;
    height: 100%;
    border-radius: 0;
  }

  .dshMarketHeader,
  .dshMarketViewBar,
  .dshMarketSectionHead,
  .dshMarketToolbar,
  .dshMarketSource,
  .dshMarketSourceActions {
    align-items: stretch;
  }

  .dshMarketHeader,
  .dshMarketViewBar,
  .dshMarketSectionHead,
  .dshMarketToolbar {
    flex-wrap: wrap;
  }

  .dshMarketSearch {
    min-width: 100%;
    order: 2;
  }

  .dshMarketGrid,
  .dshMarketSource,
  .dshMarketReceipt {
    grid-template-columns: 1fr;
  }

  .dshMarketOperationFacts > div {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .dshMarketSourceActions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
`;
		function installMarketStyles() {
			if (document.querySelector(`style[data-plugin="${STYLE_ID}"]`) !== null) return () => {};
			const style = document.createElement("style");
			style.dataset.plugin = STYLE_ID;
			style.textContent = css;
			document.head.append(style);
			return () => {
				style.remove();
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "locale"];
		const NS = "community-market";
		function apply(ctx) {
			const marketView = createMarketViewStore();
			const readLocale = () => ctx.locale.getLocale().active;
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "community-market: dictionaries");
			ctx.effect(() => installMarketStyles(), "community-market: styles");
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "community-market",
				order: 20,
				label: () => ctx.locale.bind(NS)("tab"),
				locale: NS,
				inject: () => ({ readLocale })
			}, MarketSettingsTab));
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "community-market",
				order: 10,
				label: () => ctx.locale.bind(NS)("tab"),
				locale: NS,
				store: marketView
			}, MarketLauncher));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "community-market",
				order: 10,
				locale: NS,
				store: marketView,
				inject: () => ({ readLocale })
			}, MarketOverlay));
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
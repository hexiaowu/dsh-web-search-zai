/**
 * Browser half: a small settings form on the Plugins page for the Z.ai API key.
 *
 * The Host half only exposes a `Config` schema; the Plugins page renders a
 * bundle's own configuration through the keyed `plugins.bundle.config` slot, so
 * this module registers a form there. The form writes the key through the DSH
 * credential seam (`remote.credentials.set`) under the reference the provider
 * reads (`ZAI_CODING_CN_API_KEY`), never into the profile patch or a session
 * log. It only reads back `configured`/`writable`, never the key itself.
 *
 * Loaded through the Web client module table; React and the slot/remote/locale
 * services are provided by the host.
 */
window.__ModuleLoader__.load({
  id: '@hexiaowu/dsh-web-search-zai',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace, shared with the package's locale resources. */
    const NS = 'dsh-web-search-zai';
    /** Credential reference the Host provider resolves at each search. */
    const KEY_REF = 'ZAI_CODING_CN_API_KEY';
    /** Host route behind the Test button; keep in sync with lib/index.js. */
    const TEST_PATH = '/dsh-web-search-zai/test';
    /** Host route that reveals the current key to this local Settings page. */
    const KEY_PATH = '/dsh-web-search-zai/key';

    const zh = {
      nav: 'Z.ai 搜索',
      keyTitle: 'API Key',
      keyHint: '保存在 DSH 凭据库的 refs 段，不会写进 profile 配置，也不会出现在会话日志里。输入框默认明文显示当前 key（本机 loopback 读取），输入框内右侧的眼睛图标可切换明文/隐藏；保存后下一次 web_search 立即生效。若插件配置里填了字面 apiKey，它会优先，建议保持为空。',
      refLabel: '引用名',
      placeholder: '粘贴 Z.ai / 智谱 coding plan key',
      configured: '已配置',
      notConfigured: '未配置',
      checking: '检查中…',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，下一次搜索生效。',
      empty: '请先输入 key。',
      readError: '读取 key 状态失败。',
      saveError: '保存失败，请检查凭据库权限后重试。',
      managedElsewhere: '当前 key 由启动环境提供，不能在这里替换。',
      fallbackTitle: 'Z.ai 不可用时回退到 DeepSeek',
      fallbackHint: 'Z.ai 全部失败时按 deepseek-official → deepseek-search-api 顺序尝试；会使用 DeepSeek 额度。',
      configUnavailable: '配置服务不可用，回退开关暂不可用。',
      configSaved: '回退设置已保存。',
      configError: '回退设置保存失败。',
      testTitle: '测试搜索',
      testHint: '会真实调用一次搜索（消耗一次 Z.ai 套餐调用；Z.ai 失败时可能走 DeepSeek）。',
      testRun: '测试',
      testRunning: '测试中…',
      testOk: '搜索可用',
      sourcesUnit: ' 条结果',
      testFailed: '搜索失败',
      testUnavailable: '测试端点不可用（重启 Harness 后重试）。',
      showKey: '显示',
      hideKey: '隐藏',
    };
    const en = {
      nav: 'Z.ai search',
      keyTitle: 'API key',
      keyHint: 'Stored in the DSH credential store under refs, never in the profile configuration or a session log. The field shows the current key in plain text by default (read from a local loopback endpoint); the eye icon inside the input toggles visibility. The next web_search uses a saved key immediately. A literal apiKey in the plugin config takes precedence, so leave it empty.',
      refLabel: 'Reference',
      placeholder: 'Paste a Z.ai / GLM coding plan key',
      configured: 'Configured',
      notConfigured: 'Not configured',
      checking: 'Checking…',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved. The next search uses the new key.',
      empty: 'Enter a key first.',
      readError: 'Could not read the key status.',
      saveError: 'Could not save the key. Check the credential store permissions and retry.',
      managedElsewhere: 'This key comes from the launch environment and cannot be replaced here.',
      fallbackTitle: 'Fall back to DeepSeek when Z.ai is down',
      fallbackHint: 'Tries deepseek-official, then deepseek-search-api, after every Z.ai attempt fails. Uses DeepSeek quota.',
      configUnavailable: 'The configuration service is unavailable; the fallback switch is disabled.',
      configSaved: 'Fallback setting saved.',
      configError: 'Could not save the fallback setting.',
      testTitle: 'Test search',
      testHint: 'Runs one real search (one Z.ai plan call; may use DeepSeek when Z.ai fails).',
      testRun: 'Test',
      testRunning: 'Testing…',
      testOk: 'Search works',
      sourcesUnit: ' sources',
      testFailed: 'Search failed',
      testUnavailable: 'The test endpoint is unavailable (restart Harness and retry).',
      showKey: 'Show',
      hideKey: 'Hide',
    };

    const styles = {
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        maxWidth: 760,
        boxSizing: 'border-box',
      },
      header: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
      title: { fontSize: 13, fontWeight: 600 },
      hint: { fontSize: 11, lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)' },
      meta: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' },
      code: {
        fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
        fontSize: 10.5,
      },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      inputWrap: {
        position: 'relative',
        flex: '1 1 280px',
        minWidth: 0,
        display: 'flex',
      },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 36px 7px 9px',
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        outline: 'none',
      },
      button: (busy) => ({
        padding: '7px 14px',
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'var(--dsw-alias-brand-primary)',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        fontSize: 12,
        fontWeight: 500,
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.7 : 1,
      }),
      message: { fontSize: 11, color: 'var(--dsw-alias-state-success-primary)' },
      error: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' },
      divider: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '2px 0' },
      toggleRow: { display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' },
      toggleCopy: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
      toggleTitle: { fontSize: 12, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      link: { fontSize: 11, color: 'var(--dsw-alias-brand-primary)', wordBreak: 'break-all' },
      eyeButton: {
        position: 'absolute',
        right: 6,
        top: '50%',
        transform: 'translateY(-50%)',
        width: 26,
        height: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        border: 'none',
        borderRadius: 6,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
      },
    };

    /** Password visibility glyph; `off` draws the slash for the visible state. */
    function EyeIcon({ off }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z' }),
        h('circle', { cx: 12, cy: 12, r: 3 }),
        off ? h('path', { d: 'm4 4 16 16' }) : null,
      );
    }

    /** The Z.ai search settings form: key, fallback switch, and test button. */
    function KeyForm(props) {
      const { t, describeKey, setKey, form, testPath } = props;
      const [state, setState] = React.useState({
        loading: true,
        configured: false,
        writable: true,
        draft: '',
        busy: false,
        message: '',
        error: '',
      });
      const [config, setConfig] = React.useState(() => (typeof form?.getSnapshot === 'function' ? form.getSnapshot() : undefined));
      const [fallbackBusy, setFallbackBusy] = React.useState(false);
      const [fallbackNotice, setFallbackNotice] = React.useState('');
      const [fallbackNoticeError, setFallbackNoticeError] = React.useState(false);
      const [test, setTest] = React.useState({ busy: false, result: null, error: '' });
      const [revealKey, setRevealKey] = React.useState(true);

      React.useEffect(() => {
        if (!form || typeof form.subscribe !== 'function') return undefined;
        setConfig(form.getSnapshot());
        return form.subscribe(() => setConfig(form.getSnapshot()));
      }, [form]);

      const refresh = React.useCallback(async () => {
        try {
          const response = await describeKey([KEY_REF]);
          if (!response || response.ok === false) throw new Error('describe failed');
          const info = response.value ? response.value[KEY_REF] : undefined;
          setState((current) => ({
            ...current,
            loading: false,
            configured: info?.configured === true,
            writable: info?.writable !== false,
          }));
        } catch {
          setState((current) => ({ ...current, loading: false, error: t('readError') }));
        }
      }, [describeKey, t]);

      React.useEffect(() => {
        refresh();
      }, [refresh]);

      React.useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const response = await fetch(KEY_PATH, {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            });
            if (!response.ok) return;
            const data = await response.json();
            if (
              !cancelled
              && data?.ok === true
              && typeof data.apiKey === 'string'
              && data.apiKey.length > 0
            ) {
              setState((current) => (current.draft.length === 0
                ? { ...current, draft: data.apiKey }
                : current));
            }
          } catch {
            // The field still accepts a new key when the read is unavailable.
          }
        })();
        return () => {
          cancelled = true;
        };
      }, []);

      const update = (patch) => setState((current) => ({ ...current, ...patch }));

      const onSave = async () => {
        if (state.busy || !state.writable) return;
        const value = state.draft.trim();
        if (value.length === 0) {
          update({ error: t('empty'), message: '' });
          return;
        }
        update({ busy: true, error: '', message: '' });
        try {
          const response = await setKey(KEY_REF, value);
          if (response && response.ok === false) throw new Error('set failed');
          await refresh();
          update({ busy: false, message: t('saved') });
        } catch {
          update({ busy: false, error: t('saveError') });
        }
      };

      const onKeyDown = (event) => {
        if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing) return;
        event.preventDefault();
        onSave();
      };

      const fallbackEnabled = config?.value?.fallbackEnabled !== false;
      const fallbackBase = config?.base?.fallbackEnabled !== false;
      const fallbackWritable = form !== undefined
        && config !== undefined
        && config.status === 'ready'
        && config.writable !== false;

      const onToggleFallback = async (event) => {
        const next = event.target.checked;
        if (!form || !fallbackWritable) return;
        setFallbackBusy(true);
        setFallbackNotice('');
        setFallbackNoticeError(false);
        try {
          const ok = next === fallbackBase
            ? await form.unset('fallbackEnabled')
            : await form.set('fallbackEnabled', next);
          setFallbackBusy(false);
          if (ok) {
            setFallbackNotice(t('configSaved'));
          } else {
            setFallbackNotice(t('configError'));
            setFallbackNoticeError(true);
          }
        } catch {
          setFallbackBusy(false);
          setFallbackNotice(t('configError'));
          setFallbackNoticeError(true);
        }
      };

      const onTest = async () => {
        if (test.busy) return;
        setTest({ busy: true, result: null, error: '' });
        try {
          const response = await fetch(testPath ?? TEST_PATH, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
          if (!response.ok) {
            setTest({
              busy: false,
              result: null,
              error: response.status === 404 ? t('testUnavailable') : `HTTP ${response.status}`,
            });
            return;
          }
          const data = await response.json();
          if (data?.ok === true) setTest({ busy: false, result: data, error: '' });
          else setTest({ busy: false, result: data, error: data?.message ?? t('testFailed') });
        } catch {
          setTest({ busy: false, result: null, error: t('testUnavailable') });
        }
      };

      return h(
        'section',
        { style: styles.card, 'data-zai-settings': 'api-key' },
        h(
          'div',
          { style: styles.header },
          h('span', { style: styles.title }, t('keyTitle')),
          h(
            'span',
            {
              style: {
                fontSize: 11,
                color: state.configured
                  ? 'var(--dsw-alias-state-success-primary)'
                  : 'var(--dsw-alias-label-secondary)',
              },
            },
            state.loading ? t('checking') : state.configured ? t('configured') : t('notConfigured'),
          ),
        ),
        h('div', { style: styles.hint }, t('keyHint')),
        h(
          'div',
          { style: styles.meta },
          `${t('refLabel')}: `,
          h('code', { style: styles.code }, KEY_REF),
        ),
        h(
          'div',
          { style: styles.row },
          h(
            'div',
            { style: styles.inputWrap },
            h('input', {
              type: revealKey ? 'text' : 'password',
              value: state.draft,
              placeholder: t('placeholder'),
              'aria-label': t('keyTitle'),
              autoComplete: 'off',
              spellCheck: false,
              disabled: state.busy || !state.writable,
              onChange: (event) => update({ draft: event.target.value, error: '', message: '' }),
              onKeyDown,
              style: {
                ...styles.input,
                opacity: state.writable ? 1 : 0.6,
              },
            }),
            h(
              'button',
              {
                type: 'button',
                'aria-label': revealKey ? t('hideKey') : t('showKey'),
                'aria-pressed': revealKey,
                title: revealKey ? t('hideKey') : t('showKey'),
                onClick: () => setRevealKey((value) => !value),
                style: styles.eyeButton,
              },
              h(EyeIcon, { off: revealKey }),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: state.busy || !state.writable,
              onClick: onSave,
              style: styles.button(state.busy),
            },
            state.busy ? t('saving') : t('save'),
          ),
        ),
        state.message ? h('div', { style: styles.message }, state.message) : null,
        state.error ? h('div', { style: styles.error }, state.error) : null,
        !state.writable ? h('div', { style: styles.hint }, t('managedElsewhere')) : null,
        h('div', { style: styles.divider }),
        h(
          'label',
          { style: styles.toggleRow },
          h('input', {
            type: 'checkbox',
            checked: fallbackEnabled,
            disabled: fallbackBusy || !fallbackWritable,
            onChange: onToggleFallback,
            style: { marginTop: 2 },
          }),
          h(
            'span',
            { style: styles.toggleCopy },
            h('span', { style: styles.toggleTitle }, t('fallbackTitle')),
            h('span', { style: styles.hint }, t('fallbackHint')),
            !form || config?.status === 'unavailable' ? h('span', { style: styles.hint }, t('configUnavailable')) : null,
          ),
        ),
        fallbackNotice
          ? h('div', { style: fallbackNoticeError ? styles.error : styles.message }, fallbackNotice)
          : null,
        h('div', { style: styles.divider }),
        h('div', { style: styles.header }, h('span', { style: styles.title }, t('testTitle'))),
        h(
          'div',
          { style: styles.row },
          h(
            'button',
            {
              type: 'button',
              disabled: test.busy,
              onClick: onTest,
              style: styles.button(test.busy),
            },
            test.busy ? t('testRunning') : t('testRun'),
          ),
          h('span', { style: styles.hint }, t('testHint')),
        ),
        test.result?.ok === true
          ? h(
              'div',
              { style: styles.message },
              `${t('testOk')} · ${test.result.count}${t('sourcesUnit')}${test.result.firstTitle ? ` · ${test.result.firstTitle}` : ''}`,
            )
          : null,
        test.result?.ok === true && test.result.firstUrl
          ? h(
              'a',
              { href: test.result.firstUrl, target: '_blank', rel: 'noreferrer', style: styles.link },
              test.result.firstUrl,
            )
          : null,
        test.error
          ? h(
              'div',
              { style: { ...styles.error, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' } },
              test.error,
            )
          : null,
      );
    }

    /** Settings-section icon: the same magnifier/Z mark as the bundle icon. */
    function ZaiIcon({ size }) {
      const dimension = Number.isFinite(size) ? size : 16;
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: dimension,
          height: dimension,
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('circle', { cx: 10.5, cy: 10.5, r: 6 }),
        h('path', { d: 'm15 15 5 5' }),
        h('path', { d: 'M8 8h5l-5 5h5' }),
      );
    }



    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-web-search-zai: dictionaries');

        const describeKey = (refs) => ctx.remote.credentials.describe(refs);
        const setKey = (ref, value) => ctx.remote.credentials.set(ref, value);
        const form = ctx.configForms?.get?.('web-search-zai');
        const settingsProps = () => ({ t, describeKey, setKey, form, testPath: TEST_PATH });

        // The one UI entry: a first-class Settings section, like dsh-mcp-link's
        // "MCP 联动". The Plugins bundle card only installs/enables the bundle.
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'web-search-zai',
          order: 19,
          label: () => t('nav'),
          locale: NS,
          inject: settingsProps,
        }, KeyForm));

        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'web-search-zai',
          locale: NS,
        }, ZaiIcon));
      },
    };
  },
});

// SCR-RESULT-01 · 02 결과 (PRD §7.2): 요약 · 만세력 · 오행/십성 · 해석 탭 · 대운/세운
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, C, Chip, ErrorText, OH } from '../components/ui';
import {
  ELEMENTS, ELEMENT_HANJA, LABELS, ReadingError, branchInfo, createShare, errorMessage, fetchMe, listProfiles, loadLast, loadMatchDraft, requestReading, sameSaju, saveLast, saveMatchDraft,
  saveProfile, seoulToday, startGoogleLogin, stemInfo, track, zodiac,
} from '../lib/saju';
import type { Me, Reading, Saved } from '../lib/saju';

const COLUMNS = [['hour', '시주'], ['day', '일주'], ['month', '월주'], ['year', '연주']] as const; // 전통 표기: 오른쪽이 연주
const GROUPS = ['BIGEOP', 'SIKSANG', 'JAESEONG', 'GWANSEONG', 'INSEONG'];
const GROUP_TINTS = ['#1B1F24', '#4E5752', '#7C857F', '#A9B1AB', '#D3D9D3'];
const LUCK_CARD_W = 92;

const goToInput = () => (router.canGoBack() ? router.back() : router.replace('/input'));

export default function ResultScreen() {
  const [saved, setSaved] = useState<Saved | null | undefined>(undefined);
  const { from } = useLocalSearchParams<{ from?: string }>();

  useEffect(() => {
    loadLast().then(s => {
      setSaved(s);
      if (!s) return;
      track('result_view', { source: from === 'submit' || from === 'archive' ? from : 'recent' });
      // 오늘의 운세는 날짜마다 달라지므로, 기기에 저장된 결과가 오늘 것이 아니면 조용히 다시 계산해 온다
      if (s.reading.chart.today?.date !== seoulToday()) {
        requestReading(s.profile, s.options)
          .then(reading => {
            const next = { ...s, reading };
            setSaved(next);
            saveLast(next);
          })
          .catch(() => {});
      }
    });
  }, []);

  if (saved === undefined) return <View style={st.screen} />;
  if (!saved) {
    return (
      <View style={[st.screen, st.empty]}>
        <Text style={st.h2}>아직 본 사주가 없습니다</Text>
        <Button label="사주 정보 입력하기" onPress={() => router.replace('/input')} />
      </View>
    );
  }

  return <ResultBody saved={saved} />;
}

/** 결과 화면 본문. shared = 공유 링크로 연 남의 결과 (수정 · 저장 · 공유 없음, 내 사주 보기로 유도) */
export function ResultBody({ saved, shared = false }: { saved: Saved; shared?: boolean }) {
  const { width } = useWindowDimensions();
  const { chart, report } = saved.reading;
  const left = (
    <>
      <Header saved={saved} shared={shared} />
      <Summary reading={saved.reading} />
      {!shared && <SaveToArchive saved={saved} />}
      <ChartTable saved={saved} />
      <OhaengBars chart={chart} />
      <TenGodBar chart={chart} />
    </>
  );
  const right = (
    <>
      <Interpretation key={chart.today?.date ?? 'initial'} report={report} />
      <Luck chart={chart} />
      <Text style={st.disclaimer}>전통 명리 이론에 기반한 참고용 해석이며, 의학·법률·투자 판단의 근거가 아닙니다.</Text>
      {shared
        ? <Button label="내 사주도 보기" onPress={() => router.replace('/')} />
        : (
          <>
            <Button
              label="다른 사람과 궁합 보기"
              onPress={async () => {
                // 이 사주를 "나" 칸에 넣고 궁합 고르기로
                await saveMatchDraft({ ...(await loadMatchDraft()), a: { profile: saved.profile, options: saved.options } });
                router.push('/match');
              }}
            />
            <Button variant="secondary" label="다른 사주 입력하기" onPress={goToInput} />
          </>
        )}
    </>
  );

  if (width >= 1024) {
    return (
      <View style={[st.screen, st.wide]}>
        <ScrollView style={st.wideLeft} contentContainerStyle={st.column}>{left}</ScrollView>
        <ScrollView style={st.grow} contentContainerStyle={[st.column, st.wideRightColumn]}>{right}</ScrollView>
      </View>
    );
  }
  return (
    <ScrollView style={st.screen} contentContainerStyle={[st.column, st.narrow]}>
      {left}
      {right}
    </ScrollView>
  );
}

/**
 * 보관함에 저장 (웹). 로그인 전이면 Google 로그인 후 /result?save=1 로 돌아와 이 결과를 이어서 저장한다.
 * 비회원 결과는 서버에 두지 않고, 로그인 전 "저장" 의도를 이어받는 방식으로 계정에 옮긴다.
 */
function SaveToArchive({ saved }: { saved: Saved }) {
  const { save } = useLocalSearchParams<{ save?: string }>();
  const [status, setStatus] = useState<'idle' | 'saving' | 'created' | 'existing'>('idle');
  const [error, setError] = useState<string>();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    fetchMe().then(user => {
      setMe(user);
      if (!user) return;
      // 이미 보관함에 있는 사주면 처음부터 "보관함 보기"로 (방금 저장한 결과 표시는 덮어쓰지 않음)
      listProfiles()
        .then(({ profiles }) => {
          if (profiles.some(p => sameSaju(p, saved.profile))) setStatus(s => (s === 'idle' ? 'existing' : s));
        })
        .catch(() => {});
    });
  }, []);
  const guest = me === null; // 확인 중(undefined)에는 로그인 문구를 먼저 보여 주지 않도록 비회원 판정은 null일 때만

  const run = async (afterLogin: boolean) => {
    setStatus('saving');
    setError(undefined);
    try {
      const { created } = await saveProfile(saved.profile, saved.options);
      setStatus(created ? 'created' : 'existing');
      track('save', { created, afterLogin });
    } catch (e) {
      const code = e instanceof ReadingError ? e.errors[0]?.code : 'SERVER_ERROR';
      if (code === 'UNAUTHORIZED' && !afterLogin) {
        startGoogleLogin('/result?save=1');
        setStatus('idle');
        return;
      }
      setStatus('idle');
      setError(errorMessage(code));
    }
  };

  useEffect(() => {
    if (save !== '1') return;
    router.setParams({ save: undefined }); // 새로고침해도 다시 저장하지 않게 (다시 보내도 중복 저장은 안 됨)
    run(true);
  }, []);

  if (Platform.OS !== 'web') return null;
  const done = status === 'created' || status === 'existing';
  return (
    <View style={st.card}>
      <View style={st.saveRow}>
        <Text style={[st.sectionTitle, st.grow]}>보관함 · 공유</Text>
        {done ? (
          <Button size="sm" variant="secondary" label="보관함 보기" onPress={() => router.push('/archive')} />
        ) : guest ? (
          <Button size="sm" label="Google 로그인하고 저장" onPress={() => startGoogleLogin('/result?save=1')} />
        ) : (
          <Button size="sm" label="보관함에 저장" onPress={() => run(false)} loading={status === 'saving'} loadingLabel="저장 중…" />
        )}
      </View>
      <Text style={st.meta} accessibilityLiveRegion="polite">
        {status === 'created' ? '보관함에 저장했습니다.'
          : status === 'existing' ? '이미 보관함에 있는 사주입니다.'
          : guest ? '보관함 저장과 링크 공유는 Google 로그인 후 쓸 수 있어요. 로그인하면 이 결과가 바로 저장됩니다.'
          : '저장해 두면 로그인한 어느 기기에서든 다시 볼 수 있어요.'}
      </Text>
      <ErrorText>{error}</ErrorText>
      {me && <ShareLink saved={saved} />}
      <Text style={st.caption}>다른 사람의 생년월일시는 본인 동의를 받은 뒤 저장 · 공유해 주세요.</Text>
    </View>
  );
}

/** 공유 링크 (웹, 로그인 후). 링크는 보관함 사주로 만들므로 아직 저장 전이면 함께 저장된다 */
function ShareLink({ saved }: { saved: Saved }) {
  const [hideBirth, setHideBirth] = useState(true);
  const [link, setLink] = useState<{ url: string; hideBirth: boolean }>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'; // 휴대폰 공유 창 (카카오톡 등)

  const create = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { profile } = await saveProfile(saved.profile, saved.options);
      const { token } = await createShare(profile.profileId, hideBirth);
      setLink({ url: `${window.location.origin}/s/${token}`, hideBirth });
      setCopied(false);
    } catch (e) {
      setError(errorMessage(e instanceof ReadingError ? e.errors[0]?.code : 'SERVER_ERROR'));
    } finally {
      setBusy(false);
    }
  };

  // 공유 창 · 복사는 링크를 만든 뒤 따로 누르게 한다 (서버 응답을 기다린 뒤에는 브라우저가 공유 창을 막을 수 있음)
  const send = async (channel: 'native' | 'copy') => {
    if (!link) return;
    try {
      if (channel === 'native') {
        await navigator.share({ title: '사주 四柱', text: `${saved.profile.name ? `${saved.profile.name}님의 ` : ''}사주 풀이`, url: link.url });
      } else {
        await navigator.clipboard.writeText(link.url);
        setCopied(true);
      }
      track('share', { channel, hideBirth: link.hideBirth });
    } catch (e) {
      // 공유 창을 닫은 경우(AbortError)는 조용히 넘기고, 복사 실패는 직접 복사하도록 안내
      if (channel === 'copy') setError('복사하지 못했어요. 위 주소를 길게 누르거나 드래그해서 복사해 주세요.');
      else if (!(e instanceof DOMException && e.name === 'AbortError')) setError('공유 창을 열지 못했어요. 링크 복사를 이용해 주세요.');
    }
  };

  return (
    <View style={st.shareBox}>
      <View style={st.saveRow}>
        <Text style={[st.itemTitle, st.grow]}>링크 공유</Text>
        <Pressable
          onPress={() => { setHideBirth(h => !h); setLink(undefined); }}
          accessibilityRole="checkbox" accessibilityLabel="생년월일시 가리기" aria-checked={hideBirth} hitSlop={8} style={st.check}
        >
          <View style={[st.box, hideBirth && st.boxOn]}>{hideBirth ? <Text style={st.boxMark}>✓</Text> : null}</View>
          <Text style={st.checkText}>생년월일시 가리기</Text>
        </Pressable>
      </View>
      {link ? (
        <>
          <Text selectable style={st.shareUrl}>{link.url}</Text>
          <View style={st.saveRow}>
            {canShare && <View style={st.grow}><Button size="sm" label="공유하기" onPress={() => send('native')} /></View>}
            <View style={st.grow}>
              <Button size="sm" variant={canShare ? 'secondary' : 'primary'} label={copied ? '복사했어요' : '링크 복사'} onPress={() => send('copy')} />
            </View>
          </View>
        </>
      ) : (
        <Button size="sm" label="공유 링크 만들기" onPress={create} loading={busy} loadingLabel="만드는 중…" />
      )}
      <ErrorText>{error}</ErrorText>
      <Text style={st.caption}>링크가 있는 사람은 로그인 없이 볼 수 있고, 30일 뒤 만료됩니다. 사주를 보관함에서 지우면 링크도 사라집니다.</Text>
    </View>
  );
}

function Header({ saved, shared }: { saved: Saved; shared: boolean }) {
  const { profile, reading } = saved;
  const { converted, chart } = reading;
  return (
    <View style={st.header}>
      <View style={st.grow}>
        <Text style={st.name}>{profile.name || '이름 없음'} · {profile.gender === 'F' ? '여' : '남'}</Text>
        {converted ? (
          <>
            <Text style={st.meta}>양력 {converted.solarDate.replaceAll('-', '.')} {profile.birthTime ?? '시간 모름'}</Text>
            <Text style={st.meta}>
              음력 {converted.lunar.date.replaceAll('-', '.')}{converted.lunar.isLeapMonth ? ' (윤달)' : ''} · {zodiac(chart.pillars.year.branch)}띠
            </Text>
          </>
        ) : (
          <Text style={st.meta}>생년월일시 비공개 · {zodiac(chart.pillars.year.branch)}띠</Text>
        )}
      </View>
      {!shared && (
        <Pressable onPress={goToInput} accessibilityRole="button" hitSlop={10}>
          <Text style={st.link}>수정</Text>
        </Pressable>
      )}
    </View>
  );
}

function Summary({ reading }: { reading: Reading }) {
  const { chart, report } = reading;
  const dm = stemInfo(chart.dm.stem);
  const oh = OH[dm.element];
  const headline = report.categories.find(c => c.category === 'PERSONALITY')?.sections.find(s => s.section === 'SUMMARY')?.items[0];
  return (
    <View style={st.card}>
      <View style={st.summaryRow}>
        <View style={[st.bigCell, { backgroundColor: oh.bg, borderColor: oh.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[st.bigHanja, { color: oh.fg }]}>{dm.hanja}</Text>
        </View>
        <View style={[st.grow, { gap: 4 }]}>
          <Text style={st.eyebrow}>{chart.dm.nameKo} 일간</Text>
          <Text style={st.h2}>{headline?.title ?? `${chart.dm.nameKo} 일간`}</Text>
        </View>
      </View>
      <View style={st.chips}>
        <Chip label={LABELS[chart.strength.band]} />
        <Chip label={`${LABELS[chart.gyeok]}격`} />
        {chart.oh.missing.map((e: string) => <Chip key={e} label={`${LABELS[e]} 없음`} />)}
      </View>
    </View>
  );
}

function GanjiCell({ info, label, dayMaster }: { info: ReturnType<typeof stemInfo>; label: string; dayMaster?: boolean }) {
  const oh = OH[info.element];
  const cell = (
    <View
      accessible
      accessibilityLabel={`${label} ${info.ko}, ${LABELS[info.element]}, ${info.yang ? '양' : '음'}${dayMaster ? ', 일간' : ''}`}
      style={[st.cell, { backgroundColor: oh.bg, borderColor: oh.border }]}
    >
      {/* 고정 크기 칸이라 글꼴 확대를 1.3배로 제한 (넘치면 칸 밖으로 겹침) */}
      <Text maxFontSizeMultiplier={1.3} style={[st.cellYinYang, { color: oh.fg }]}>{info.yang ? '+' : '−'}</Text>
      <Text maxFontSizeMultiplier={1.3} style={[st.cellHanja, { color: oh.fg }]}>{info.hanja}</Text>
      <Text maxFontSizeMultiplier={1.3} style={[st.cellKo, { color: oh.fg }]}>{info.ko}</Text>
    </View>
  );
  return dayMaster ? <View style={st.dayMaster}>{cell}</View> : cell;
}

function ChartTable({ saved }: { saved: Saved }) {
  const { chart, notices } = saved.reading;
  const row = (label: string, render: (key: string, column: string) => ReactNode, tall = false) => (
    <View style={[st.tRow, tall && st.tRowTall]}>
      <Text style={st.tLabel}>{label}</Text>
      {COLUMNS.map(([key, column]) => (
        <View key={key} style={st.tCell}>{render(key, column)}</View>
      ))}
    </View>
  );
  const text = (value: string, strong = false) => <Text style={[st.tText, strong && st.bold]}>{value}</Text>;
  const caption = [
    ...notices.map(n => n.text),
    saved.options.jasiMode === 'UNIFIED' ? '자시: 23시에 날짜 변경' : '자시: 야자시·조자시 구분',
  ];

  return (
    <View style={st.card}>
      <Text style={st.sectionTitle}>만세력</Text>
      <View style={st.tRow}>
        <Text style={st.tLabel} />
        {COLUMNS.map(([key, column]) => <Text key={key} style={[st.tCell, st.tHead]}>{column}</Text>)}
      </View>
      {row('십성', key => (key === 'day' ? text('일간', true) : text(LABELS[chart.tenGods[key]?.stem] ?? '')))}
      {row('천간', (key, column) => (chart.pillars[key]
        ? <GanjiCell info={stemInfo(chart.pillars[key].stem)} label={`${column} 천간`} dayMaster={key === 'day'} />
        : <View style={[st.cell, st.cellEmpty]}><Text style={st.cellEmptyText}>시간{'\n'}미상</Text></View>), true)}
      {row('지지', (key, column) => (chart.pillars[key]
        ? <GanjiCell info={branchInfo(chart.pillars[key].branch)} label={`${column} 지지`} />
        : <View style={[st.cell, st.cellEmpty]} />), true)}
      {row('십성', key => text(LABELS[chart.tenGods[key]?.branch] ?? ''))}
      {row('지장간', key => text((chart.hiddenStems[key] ?? []).map((h: string) => LABELS[h]).join('')))}
      {row('12운성', key => text(LABELS[chart.twelveStages[key]] ?? ''))}
      <Text style={st.caption}>{caption.join('\n')}</Text>
    </View>
  );
}

function OhaengBars({ chart }: { chart: any }) {
  return (
    <View style={st.card}>
      <Text style={st.sectionTitle}>오행 분포</Text>
      <View style={{ gap: 10 }}>
        {ELEMENTS.map((e, i) => {
          const ratio: number = chart.oh.ratio[e];
          const count: number = chart.oh.count[e];
          const pct = Math.round(ratio * 100);
          return (
            <View key={e} style={st.barRow} accessible accessibilityLabel={`${LABELS[e]} ${pct}퍼센트, ${count}개`}>
              <Text style={st.barLabel}>{LABELS[e]} <Text style={st.muted}>{ELEMENT_HANJA[i]}</Text></Text>
              <View style={st.track}>
                {ratio > 0 && <View style={[st.fill, { width: `${ratio * 100}%`, backgroundColor: OH[e].bg, borderColor: OH[e].border }]} />}
              </View>
              <Text style={st.barValue}>{pct}% · {count}</Text>
              <View style={st.barChip}>{count === 0 ? <Chip label="없음" /> : ratio >= 0.35 ? <Chip label="많음" /> : null}</View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TenGodBar({ chart }: { chart: any }) {
  const group = chart.ss.group as Record<string, number>;
  return (
    <View style={st.card}>
      <Text style={st.sectionTitle}>십성 분포</Text>
      <View style={st.stack} accessible accessibilityLabel={GROUPS.map(g => `${LABELS[g]} ${group[g]}`).join(', ')}>
        {GROUPS.map((g, i) => (group[g] > 0 ? <View key={g} style={{ flex: group[g], backgroundColor: GROUP_TINTS[i] }} /> : null))}
      </View>
      <View style={st.legend}>
        {GROUPS.map((g, i) => (
          <View key={g} style={st.legendItem}>
            <View style={[st.swatch, { backgroundColor: GROUP_TINTS[i] }]} />
            <Text style={st.meta}>{LABELS[g]} {group[g]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Interpretation({ report }: { report: Reading['report'] }) {
  const [tab, setTab] = useState(report.categories[0].category);
  const category = report.categories.find(c => c.category === tab)!;
  return (
    <View style={st.card}>
      <ScrollRow label="운세 탭" step={200} title={<Text style={st.sectionTitle}>풀이</Text>}>
        {report.categories.map(c => {
          const on = c.category === tab;
          return (
            <Pressable key={c.category} onPress={() => { setTab(c.category); track('tab_view', { category: c.category }); }} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[st.tab, on && st.tabOn]}>
              <Text style={[st.tabText, on && st.tabTextOn]}>{c.title}</Text>
            </Pressable>
          );
        })}
      </ScrollRow>
      {category.sections.map(section => (
        <View key={section.section} style={[st.section, section.section === 'ADVICE' && st.advice]}>
          {section.section !== 'SUMMARY' && <Text style={st.eyebrow}>{section.title}</Text>}
          {section.items.map((item, i) => (
            <View key={i} style={{ gap: 4 }}>
              <Text style={section.section === 'SUMMARY' ? st.h3 : st.itemTitle}>{item.title}</Text>
              <Text style={st.body}>{item.text}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const MiniCell = ({ info }: { info: ReturnType<typeof stemInfo> }) => (
  <View style={[st.mini, { backgroundColor: OH[info.element].bg, borderColor: OH[info.element].border }]}>
    <Text maxFontSizeMultiplier={1.3} style={[st.miniText, { color: OH[info.element].fg }]}>{info.hanja}</Text>
  </View>
);

/**
 * 가로로 넘기는 줄. 웹에서는 마우스 휠로 가로 스크롤이 되지 않아 끝이 잘린 것처럼 보이므로
 * 스크롤바를 보이고, 제목 옆에 이전 · 다음 버튼을 둔다
 */
function ScrollRow({ title, label, step, initialX = 0, children }: {
  title: ReactNode;
  label: string;
  step: number;
  initialX?: number;
  children: ReactNode;
}) {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const size = useRef({ content: 0, view: 0 });
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = () => {
    const { content, view } = size.current;
    setEdge({ start: offset.current <= 1, end: content <= offset.current + view + 1 });
  };
  const move = (direction: 1 | -1) => ref.current?.scrollTo({ x: Math.max(0, offset.current + direction * step), animated: true });
  const arrow = (direction: 1 | -1) => {
    const disabled = direction < 0 ? edge.start : edge.end;
    return (
      <Pressable
        onPress={() => move(direction)} disabled={disabled} hitSlop={6}
        accessibilityRole="button" accessibilityLabel={`${label} ${direction < 0 ? '이전' : '다음'}`} accessibilityState={{ disabled }}
        style={({ pressed }) => [st.arrow, disabled && st.arrowDisabled, pressed && st.pressed]}
      >
        <Text style={st.arrowText}>{direction < 0 ? '‹' : '›'}</Text>
      </Pressable>
    );
  };

  return (
    <View style={st.scrollRow}>
      <View style={st.rowHead}>
        <View style={st.grow}>{title}</View>
        {arrow(-1)}
        {arrow(1)}
      </View>
      <ScrollView
        ref={ref} horizontal showsHorizontalScrollIndicator={Platform.OS === 'web'} scrollEventThrottle={32}
        contentContainerStyle={[st.luckRow, Platform.OS === 'web' && st.scrollbarRoom]}
        onScroll={e => { offset.current = e.nativeEvent.contentOffset.x; measure(); }}
        onLayout={e => { size.current.view = e.nativeEvent.layout.width; measure(); }}
        onContentSizeChange={width => {
          const first = size.current.content === 0;
          size.current.content = width;
          if (first && initialX > 0) ref.current?.scrollTo({ x: initialX, animated: false });
          measure();
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function Luck({ chart }: { chart: any }) {
  const daewoon = chart.daewoon;
  const current: number = daewoon.current?.order ?? 0;
  return (
    <View style={st.card}>
      <ScrollRow
        label="대운" step={2 * (LUCK_CARD_W + 8)} initialX={current > 1 ? (current - 2) * (LUCK_CARD_W + 8) : 0}
        title={<Text style={st.sectionTitle}>대운 <Text style={st.meta}>대운수 {daewoon.number} · {LABELS[daewoon.direction]}</Text></Text>}
      >
        {daewoon.list.map((d: any, i: number) => {
          const on = d.order === current;
          const age = daewoon.number + 10 * i;
          return (
            <View key={d.order} style={[st.luckCard, on && st.luckCardOn]} accessible accessibilityLabel={`${age}세부터 ${d.ganjiKo} 대운${on ? ', 지금' : ''}`}>
              <Text style={[st.nowTag, !on && st.hidden]}>지금</Text>
              <View style={st.miniPair}>
                <MiniCell info={stemInfo(d.stem)} />
                <MiniCell info={branchInfo(d.branch)} />
              </View>
              <Text style={st.luckAge}>{age}세</Text>
              <Text style={st.meta}>{new Date(d.startAt).getFullYear()}년~</Text>
              <Text style={st.meta}>{LABELS[d.stemGroup]}·{LABELS[d.branchGroup]}</Text>
            </View>
          );
        })}
      </ScrollRow>
      <ScrollRow label="세운" step={3 * 72} title={<Text style={st.sectionTitle}>세운</Text>}>
        {chart.seun.list.map((y: any) => (
          <View key={y.year} style={[st.seun, y.year === chart.seun.year && st.luckCardOn]} accessible accessibilityLabel={`${y.year}년 ${y.ganjiKo}`}>
            <Text style={st.meta}>{y.year}</Text>
            <Text style={st.seunGanji}>{y.ganjiKo}</Text>
          </View>
        ))}
      </ScrollRow>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  grow: { flex: 1 },
  bold: { fontWeight: '700' },
  hidden: { opacity: 0 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  column: { padding: 20, gap: 16, paddingBottom: 48 },
  narrow: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  wide: { flexDirection: 'row' },
  wideLeft: { width: 460, flexGrow: 0, borderRightWidth: 1, borderRightColor: C.rule },
  wideRightColumn: { maxWidth: 720 },
  card: { backgroundColor: C.surface, borderRadius: 12, padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 4 },
  name: { fontSize: 20, fontWeight: '700', color: C.ink },
  meta: { fontSize: 13, color: C.ink2, lineHeight: 19, fontVariant: ['tabular-nums'] },
  muted: { color: C.ink3, fontWeight: '400' },
  link: { fontSize: 15, color: C.ink, textDecorationLine: 'underline', paddingTop: 4 },
  eyebrow: { fontSize: 12, color: C.ink2, letterSpacing: 0.6, fontWeight: '600' },
  h2: { fontSize: 20, fontWeight: '700', color: C.ink, lineHeight: 28 },
  h3: { fontSize: 17, fontWeight: '700', color: C.ink, lineHeight: 25 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: C.ink },
  body: { fontSize: 15, color: C.ink, lineHeight: 25 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  caption: { fontSize: 12, color: C.ink2, lineHeight: 18 },
  disclaimer: { fontSize: 12, color: C.ink3, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12 },

  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shareBox: { gap: 10, borderTopWidth: 1, borderTopColor: C.ruleSoft, paddingTop: 12 },
  shareUrl: { fontSize: 13, color: C.ink, backgroundColor: C.ground, borderRadius: 8, padding: 10, fontVariant: ['tabular-nums'] },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: C.ink2, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.ink, borderColor: C.ink },
  boxMark: { color: C.surface, fontSize: 13, lineHeight: 15, fontWeight: '700' },
  checkText: { fontSize: 14, color: C.ink },
  bigCell: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bigHanja: { fontSize: 34, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  tRow: { flexDirection: 'row', alignItems: 'center', minHeight: 30 },
  tRowTall: { minHeight: 70 },
  tLabel: { width: 48, fontSize: 12, color: C.ink2 },
  tCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tHead: { textAlign: 'center', fontSize: 13, fontWeight: '600', color: C.ink },
  tText: { fontSize: 13, color: C.ink, textAlign: 'center' },
  cell: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dayMaster: { borderWidth: 2, borderColor: C.ink, borderRadius: 10, padding: 2 },
  cellYinYang: { position: 'absolute', top: 2, right: 5, fontSize: 10, fontWeight: '700' },
  cellHanja: { fontSize: 24, lineHeight: 28, fontWeight: '600' },
  cellKo: { fontSize: 11, lineHeight: 13 },
  cellEmpty: { borderStyle: 'dashed', borderColor: C.ink3, backgroundColor: C.surface },
  cellEmptyText: { fontSize: 11, color: C.ink2, textAlign: 'center' },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 36, fontSize: 14, fontWeight: '600', color: C.ink },
  track: { flex: 1, height: 14, borderRadius: 4, backgroundColor: C.ruleSoft, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, borderWidth: 1 },
  barValue: { width: 64, fontSize: 13, color: C.ink, textAlign: 'right', fontVariant: ['tabular-nums'] },
  barChip: { width: 48, alignItems: 'flex-start' },

  stack: { flexDirection: 'row', height: 16, borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: C.rule },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2, borderWidth: 1, borderColor: C.rule },

  tab: { paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 999, backgroundColor: C.tint },
  tabOn: { backgroundColor: C.ink },
  tabText: { fontSize: 14, color: C.ink2, fontWeight: '500' },
  tabTextOn: { color: C.surface, fontWeight: '600' },
  section: { gap: 12 },
  advice: { backgroundColor: C.ground, borderRadius: 10, padding: 14 },

  luckRow: { gap: 8 },
  scrollRow: { gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  arrow: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.rule, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  arrowDisabled: { opacity: 0.35 },
  arrowText: { fontSize: 20, lineHeight: 22, fontWeight: '600', color: C.ink },
  pressed: { opacity: 0.7 },
  scrollbarRoom: { paddingBottom: 10 }, // 웹 가로 스크롤바가 카드 테두리를 가리지 않게
  luckCard: { width: LUCK_CARD_W, alignItems: 'center', gap: 3, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: C.ruleSoft },
  luckCardOn: { borderWidth: 2, borderColor: C.ink },
  nowTag: { fontSize: 11, fontWeight: '700', color: C.ink },
  miniPair: { flexDirection: 'row', gap: 3 },
  mini: { width: 28, height: 28, borderRadius: 5, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  miniText: { fontSize: 15, fontWeight: '600' },
  luckAge: { fontSize: 14, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  seun: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.ruleSoft },
  seunGanji: { fontSize: 15, fontWeight: '600', color: C.ink },
});

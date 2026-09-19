// 궁합 보기 ②: 두 사람 · 점수 · 근거 칩 · 오행 비교 · 해석 탭 · 올해 흐름 · 결과 공유
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Button, C, OH } from '../components/ui';
import {
  ELEMENTS, ELEMENT_HANJA, LABELS, RELATIONS, createMatchShare, fetchMe, loadMatch, personName, startGoogleLogin, stemInfo, track,
} from '../lib/saju';
import type { MatchResult, Me, SavedMatch } from '../lib/saju';
import { Interpretation, ShareLink } from './result';

// 근거 칩 색: 오행 색과 겹치지 않는 좋음(초록) · 주의(노랑)
const TONE = {
  good: { bg: '#E3F1E6', fg: '#1F5A33' },
  care: { bg: '#FBEFD5', fg: '#734B00' },
};

export default function MatchResultScreen() {
  const [saved, setSaved] = useState<SavedMatch | null | undefined>(undefined);

  useEffect(() => {
    loadMatch().then(s => {
      setSaved(s);
      if (s) track('match_view', { relation: s.result.relation });
    });
  }, []);

  if (saved === undefined) return <View style={st.screen} />;
  if (!saved) {
    return (
      <View style={[st.screen, st.empty]}>
        <Text style={st.h2}>아직 본 궁합이 없습니다</Text>
        <Button label="궁합 보기" onPress={() => router.replace('/match')} />
      </View>
    );
  }

  const names = [saved.result.names?.[0] || saved.a.profile.name || '나', saved.result.names?.[1] || personName(saved.b) || '상대'];
  return (
    <MatchBody
      result={saved.result}
      names={names}
      share={<MatchShare saved={saved} names={names} />}
      actions={<Button variant="secondary" label="사람 · 관계 바꾸기" onPress={() => (router.canGoBack() ? router.back() : router.replace('/match'))} />}
    />
  );
}

/** 궁합 결과 본문 (내 결과 · 공유 링크 열람 공용). share: 왼쪽 열 끝, actions: 오른쪽 열 끝 */
export function MatchBody({ result, names, share, actions }: { result: MatchResult; names: string[]; share?: ReactNode; actions: ReactNode }) {
  const { width } = useWindowDimensions();
  const charts = [result.a.chart, result.b.chart];
  const relation = RELATIONS.find(r => r.value === result.relation)?.label;

  const person = (i: number) => {
    const dm = stemInfo(charts[i].dm.stem);
    const oh = OH[dm.element];
    return (
      <View style={st.person} accessible accessibilityLabel={`${names[i]}, 일간 ${charts[i].dm.nameKo}`}>
        <View style={[st.cell, { backgroundColor: oh.bg, borderColor: oh.border }]}>
          <Text maxFontSizeMultiplier={1.3} style={[st.cellHanja, { color: oh.fg }]}>{dm.hanja}</Text>
        </View>
        <Text style={st.personName} numberOfLines={1}>{names[i]}</Text>
        <Text style={st.meta}>{charts[i].dm.nameKo}</Text>
      </View>
    );
  };

  const left = (
    <>
      <View style={st.card}>
        <View style={st.people}>
          {person(0)}
          <View style={st.score} accessible accessibilityLabel={`${relation} 궁합 ${result.match.score}점, ${LABELS[result.match.band]}`}>
            <Text style={st.meta}>{relation} 궁합</Text>
            <Text style={st.scoreNum}>{result.match.score}<Text style={st.scoreUnit}>점</Text></Text>
          </View>
          {person(1)}
        </View>
        {/* 가운데 칸은 좁아 한글이 단어 중간에서 끊기므로 등급은 전체 폭으로 */}
        <Text style={st.band}>{LABELS[result.match.band]}</Text>
        {result.match.points.length > 0 && (
          <View style={st.points}>
            {result.match.points.map(p => (
              <View key={p.label} style={[st.point, { backgroundColor: TONE[p.tone].bg }]}>
                <Text style={[st.pointText, { color: TONE[p.tone].fg }]}>{p.tone === 'good' ? '＋ ' : '！ '}{p.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={st.card}>
        <Text style={st.sectionTitle}>오행 비교</Text>
        <View style={st.compareRow}>
          <Text style={[st.meta, st.half, st.right]} numberOfLines={1}>{names[0]}</Text>
          <View style={st.mid} />
          <Text style={[st.meta, st.half]} numberOfLines={1}>{names[1]}</Text>
        </View>
        {ELEMENTS.map((e, i) => {
          const [ra, rb] = charts.map(c => c.oh.ratio[e] as number);
          // 한 사람 안에서 50%면 칸을 꽉 채운다 (오행 하나가 절반을 넘는 경우는 드묾)
          const bar = (ratio: number) => ratio > 0 && (
            <View style={[st.bar, { width: `${Math.min(1, ratio / 0.5) * 100}%`, backgroundColor: OH[e].bg, borderColor: OH[e].border }]} />
          );
          return (
            <View
              key={e} style={st.compareRow} accessible
              accessibilityLabel={`${LABELS[e]}, ${names[0]} ${Math.round(ra * 100)}퍼센트, ${names[1]} ${Math.round(rb * 100)}퍼센트`}
            >
              <View style={[st.half, st.track, st.trackLeft]}>{bar(ra)}</View>
              <Text style={st.mid}>{LABELS[e]} <Text style={st.muted}>{ELEMENT_HANJA[i]}</Text></Text>
              <View style={[st.half, st.track]}>{bar(rb)}</View>
            </View>
          );
        })}
        <Text style={st.caption}>한쪽에 없는 오행을 다른 쪽이 가지고 있으면 서로 채워 주는 관계로 봅니다.</Text>
      </View>

      <View style={st.card}>
        <Text style={st.sectionTitle}>{charts[0].seun.year}년 두 사람의 흐름</Text>
        {charts.map((c, i) => (
          <View key={i} style={st.yearRow}>
            <Text style={st.yearName} numberOfLines={1}>{names[i]}</Text>
            <Text style={st.body}>{c.seun.ganjiKo}년 · {LABELS[c.seun.stemGroup]}의 기운이 들어오는 해</Text>
          </View>
        ))}
      </View>
      {share}
    </>
  );

  const right = (
    <>
      <Interpretation key={`${result.relation}-${result.match.score}`} report={result.report} />
      <Text style={st.disclaimer}>전통 명리 이론에 기반한 참고용 해석이며, 관계에 대한 판단은 두 사람의 몫입니다.</Text>
      {actions}
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

/** 궁합 결과 공유 (웹). 로그인 후 링크를 만들고, 비회원이면 로그인으로 (결과는 이 기기에 남아 돌아오면 그대로) */
function MatchShare({ saved, names }: { saved: SavedMatch; names: string[] }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    fetchMe().then(setMe);
  }, []);
  if (Platform.OS !== 'web' || me === undefined) return null;

  return (
    <View style={st.card}>
      <Text style={st.sectionTitle}>궁합 결과 공유</Text>
      {me ? (
        <ShareLink
          shareText={`${names[0]} · ${names[1]} 궁합 결과`}
          caption="링크가 있는 사람은 로그인 없이 볼 수 있고, 30일 뒤 만료됩니다."
          create={async hideBirth => `/m/${(await createMatchShare(saved.a, saved.b, saved.result.relation, hideBirth)).token}`}
        />
      ) : (
        <>
          <Text style={st.meta}>궁합 결과 공유는 Google 로그인 후 쓸 수 있어요.</Text>
          <Button size="sm" label="Google 로그인하고 공유" onPress={() => startGoogleLogin('/match-result')} />
        </>
      )}
      <Text style={st.caption}>다른 사람의 생년월일시는 본인 동의를 받은 뒤 공유해 주세요.</Text>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  grow: { flex: 1 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  column: { padding: 20, gap: 16, paddingBottom: 48 },
  narrow: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  wide: { flexDirection: 'row' },
  wideLeft: { width: 460, flexGrow: 0, borderRightWidth: 1, borderRightColor: C.rule },
  wideRightColumn: { maxWidth: 720 },
  card: { backgroundColor: C.surface, borderRadius: 12, padding: 16, gap: 12, borderWidth: 1, borderColor: C.rule },
  h2: { fontSize: 20, fontWeight: '700', color: C.ink },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  meta: { fontSize: 13, color: C.ink2, lineHeight: 19, fontVariant: ['tabular-nums'] },
  body: { fontSize: 15, color: C.ink, lineHeight: 22, flex: 1 },
  muted: { color: C.ink3, fontWeight: '400' },
  caption: { fontSize: 12, color: C.ink2, lineHeight: 18 },
  disclaimer: { fontSize: 12, color: C.ink3, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12 },

  people: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  person: { alignItems: 'center', gap: 4, width: 84 },
  cell: { width: 56, height: 56, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cellHanja: { fontSize: 28, fontWeight: '600' },
  personName: { fontSize: 15, fontWeight: '600', color: C.ink, maxWidth: 84 },
  score: { flex: 1, alignItems: 'center', gap: 2 },
  scoreNum: { fontSize: 40, lineHeight: 46, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },
  scoreUnit: { fontSize: 16, fontWeight: '600', color: C.ink2 },
  band: { fontSize: 14, fontWeight: '600', color: C.ink, textAlign: 'center' },
  points: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  point: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pointText: { fontSize: 13, fontWeight: '600' },

  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  half: { flex: 1 },
  right: { textAlign: 'right' },
  mid: { width: 52, textAlign: 'center', fontSize: 14, fontWeight: '600', color: C.ink },
  track: { height: 14, borderRadius: 4, backgroundColor: C.ruleSoft, overflow: 'hidden', flexDirection: 'row' },
  trackLeft: { justifyContent: 'flex-end' },
  bar: { height: '100%', borderRadius: 4, borderWidth: 1 },

  yearRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  yearName: { width: 72, fontSize: 14, fontWeight: '600', color: C.ink },
});

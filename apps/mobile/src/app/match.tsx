// 궁합 보기 ①: 두 사람과 관계 고르기. 비회원도 가능 (보관함 목록은 로그인했을 때만)
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, C, Chip, ErrorText, Segmented, Sheet } from '../components/ui';
import {
  RELATIONS, ReadingError, errorMessage, listProfiles, loadLast, loadMatchDraft, personOf, relationOfTag,
  requestMatch, sameSaju, saveMatch, saveMatchDraft, tagLabel, track,
} from '../lib/saju';
import type { ArchivedProfile, MatchDraft, Person, Profile } from '../lib/saju';

type Side = 'a' | 'b';
const SIDE_LABEL: Record<Side, string> = { a: '나', b: '상대' };

const describe = (p: Profile) =>
  `${p.gender === 'F' ? '여' : '남'} · ${p.calendar === 'LUNAR' ? '음력 ' : ''}${p.birthDate.replaceAll('-', '.')} ${p.birthTime ?? '시간 모름'}`;

export default function MatchScreen() {
  const [draft, setDraft] = useState<MatchDraft | null>(null);
  const [profiles, setProfiles] = useState<ArchivedProfile[] | null>(null); // null = 로그인 전(또는 불러오기 실패)
  const [recent, setRecent] = useState<Person | null>(null);
  const [picking, setPicking] = useState<Side | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // 입력 화면에서 사람을 새로 넣고 돌아올 때마다 다시 읽는다
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      const [saved, list, last] = await Promise.all([
        loadMatchDraft(),
        listProfiles().then(r => r.profiles).catch(() => null),
        loadLast(),
      ]);
      if (cancelled) return;
      const lastPerson = last ? { profile: last.profile, options: last.options } : null;
      // "나" 칸이 비어 있으면 대표 사주, 없으면 최근 본 사주로 채운다
      const primary = list?.find(p => p.isPrimary);
      const fill = primary ? personOf(primary) : lastPerson;
      const next = saved.a || !fill ? saved : { ...saved, a: fill };
      setProfiles(list);
      setRecent(lastPerson);
      setDraft(next);
      if (next !== saved) saveMatchDraft(next);
    })();
    return () => { cancelled = true; };
  }, []));

  if (!draft) return <View style={st.screen} />;

  const update = (next: MatchDraft) => {
    setDraft(next);
    setError(undefined);
    saveMatchDraft(next);
  };
  // 상대를 보관함에서 고르면 태그(연인 · 가족 · 친구)로 관계도 맞춘다
  const pick = (side: Side, person: Person, tag: string | null = null) => {
    update({ ...draft, [side]: person, relation: (side === 'b' && relationOfTag(tag)) || draft.relation });
    setPicking(null);
  };
  const inputNew = (side: Side) => {
    setPicking(null);
    router.push(`/input?for=${side}`);
  };

  const submit = async () => {
    if (!draft.a || !draft.b) return;
    setLoading(true);
    setError(undefined);
    track('match_submit', { relation: draft.relation });
    try {
      const result = await requestMatch(draft.a, draft.b, draft.relation);
      await saveMatch({ a: draft.a, b: draft.b, result });
      router.push('/match-result');
    } catch (e) {
      const errors = e instanceof ReadingError ? e.errors : [{ field: null, code: 'SERVER_ERROR' }];
      // 서버 필드 a.birthDate → "나: 존재하지 않는 날짜입니다."
      setError(errors.map(err => {
        const side = err.field?.split('.')[0];
        return `${side === 'a' || side === 'b' ? `${SIDE_LABEL[side]}: ` : ''}${errorMessage(err.code)}`;
      }).join('\n'));
    } finally {
      setLoading(false);
    }
  };

  const slot = (side: Side) => {
    const person = draft[side];
    return (
      <Pressable
        onPress={() => setPicking(side)} accessibilityRole="button"
        accessibilityLabel={`${SIDE_LABEL[side]}, ${person ? `${person.profile.name || '이름 없음'}, 바꾸기` : '고르기'}`}
        style={({ pressed }) => [st.slot, !person && st.slotEmpty, pressed && st.pressed]}
      >
        <Text style={st.slotLabel}>{SIDE_LABEL[side]}</Text>
        {person ? (
          <>
            <Text style={st.slotName} numberOfLines={1}>{person.profile.name || '이름 없음'}</Text>
            <Text style={st.meta}>{describe(person.profile)}</Text>
            <Text style={st.link}>바꾸기</Text>
          </>
        ) : (
          <Text style={st.slotAdd}>+ 고르기</Text>
        )}
      </Pressable>
    );
  };

  const candidates = profiles ?? [];
  const ready = !!draft.a && !!draft.b;
  return (
    <View style={st.screen}>
      <ScrollView contentContainerStyle={st.page}>
        <View style={st.column}>
          <View style={st.slots}>
            {slot('a')}
            <Text style={st.times} accessibilityElementsHidden importantForAccessibility="no">×</Text>
            {slot('b')}
          </View>

          <View style={st.field}>
            <Text style={st.label}>관계</Text>
            <Segmented label="관계" value={draft.relation} onChange={relation => update({ ...draft, relation })} options={RELATIONS} />
            <Text style={st.meta}>관계에 따라 풀이가 달라져요. 연인은 연애·결혼, 가족·친구는 소통 풀이를 함께 보여 드려요.</Text>
          </View>

          <ErrorText>{error}</ErrorText>
          <Button label="궁합 보기" onPress={submit} disabled={!ready} loading={loading} loadingLabel="궁합을 보는 중…" />
          <Text style={[st.meta, st.center]}>
            {ready ? '궁합 결과는 이 기기에만 남고 서버에 저장하지 않아요.' : '두 사람을 고르면 궁합을 볼 수 있어요.'}
          </Text>
        </View>
      </ScrollView>

      <Sheet visible={!!picking} title={picking === 'b' ? '상대 고르기' : '나 고르기'} onClose={() => setPicking(null)}>
        <ScrollView>
          <Pressable
            style={({ pressed }) => [st.listItem, pressed && st.pressed]} accessibilityRole="button"
            onPress={() => picking && inputNew(picking)}
          >
            <Text style={st.addText}>+ 새로 입력하기</Text>
          </Pressable>
          {recent && !candidates.some(p => sameSaju(p, recent.profile)) && (
            <Pressable
              style={({ pressed }) => [st.listItem, pressed && st.pressed]} accessibilityRole="button"
              accessibilityLabel={`최근 본 사주 ${recent.profile.name || '이름 없음'} 고르기`}
              onPress={() => picking && pick(picking, recent)}
            >
              <View style={st.grow}>
                <Text style={st.listName}>{recent.profile.name || '이름 없음'} <Text style={st.meta}>· 최근 본 사주</Text></Text>
                <Text style={st.meta}>{describe(recent.profile)}</Text>
              </View>
            </Pressable>
          )}
          {candidates.map(p => {
            const tag = tagLabel(p.tag);
            return (
              <Pressable
                key={p.profileId} style={({ pressed }) => [st.listItem, pressed && st.pressed]} accessibilityRole="button"
                accessibilityLabel={`${p.name || '이름 없음'}${tag ? `, ${tag}` : ''} 고르기`}
                onPress={() => picking && pick(picking, personOf(p), p.tag)}
              >
                <View style={st.grow}>
                  <View style={st.nameRow}>
                    <Text style={st.listName}>{p.name || '이름 없음'}</Text>
                    {p.isPrimary && <Chip label="대표" />}
                    {tag && <Chip label={tag} />}
                  </View>
                  <Text style={st.meta}>{describe(p)} · {p.dayPillar}일주</Text>
                </View>
              </Pressable>
            );
          })}
          {!profiles && <Text style={[st.meta, st.hint]}>Google로 로그인하면 보관함에 저장한 사주에서 고를 수 있어요.</Text>}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  page: { padding: 20, paddingBottom: 48 },
  column: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 16 },
  grow: { flex: 1 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
  slots: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  slot: { flex: 1, minHeight: 136, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.rule, padding: 14, gap: 4 },
  slotEmpty: { borderStyle: 'dashed', borderColor: C.ink3, alignItems: 'center', justifyContent: 'center' },
  slotLabel: { fontSize: 12, fontWeight: '600', color: C.ink2, letterSpacing: 0.4 },
  slotName: { fontSize: 18, fontWeight: '700', color: C.ink },
  slotAdd: { fontSize: 16, fontWeight: '600', color: C.ink, marginTop: 6 },
  times: { alignSelf: 'center', fontSize: 18, color: C.ink2 },
  link: { fontSize: 14, color: C.ink, textDecorationLine: 'underline', marginTop: 'auto', paddingTop: 6 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: C.ink },
  meta: { fontSize: 13, color: C.ink2, lineHeight: 19, fontVariant: ['tabular-nums'] },
  hint: { paddingVertical: 12 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.ruleSoft },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  listName: { fontSize: 16, fontWeight: '600', color: C.ink },
  addText: { fontSize: 16, fontWeight: '600', color: C.ink },
});

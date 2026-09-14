// SCR-MY-02 사주 보관함 (PRD §7.3): 목록 · 태그 필터 · 열기 · 태그/대표 지정 · 삭제. 로그인 필요 (웹)
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, C, Chip, ErrorText } from '../components/ui';
import {
  ReadingError, TAGS, deleteProfile, errorMessage, listProfiles, openProfile, regionName, saveLast, startGoogleLogin, tagLabel, updateProfile,
} from '../lib/saju';
import type { ArchivedProfile, Tag } from '../lib/saju';

type State =
  | { status: 'loading' }
  | { status: 'login' }
  | { status: 'error'; message: string }
  | { status: 'ready'; limit: number; profiles: ArchivedProfile[] };

const codeOf = (e: unknown) => (e instanceof ReadingError ? e.errors[0]?.code : 'SERVER_ERROR');

/** 알약 모양 선택지 (필터 · 태그 고르기 공용) */
function ChoiceChips<T extends string | null>({ label, options, value, onChange, disabled }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={st.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.label} onPress={() => onChange(o.value)} disabled={disabled}
            accessibilityRole="radio" accessibilityLabel={o.label} accessibilityState={{ checked: on, disabled }}
            style={({ pressed }) => [st.choice, on && st.choiceOn, pressed && !on && st.pressed]}
          >
            <Text style={[st.choiceText, on && st.choiceTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ArchiveScreen() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filter, setFilter] = useState<Tag | 'ALL'>('ALL');
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', ...(await listProfiles()) });
    } catch (e) {
      const code = codeOf(e);
      setState(code === 'UNAUTHORIZED' ? { status: 'login' } : { status: 'error', message: errorMessage(code) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** 버튼 하나의 비동기 작업: 진행 표시 · 오류 표시 공용 */
  const act = async (profileId: string, work: () => Promise<void>) => {
    setBusyId(profileId);
    setActionError(undefined);
    try {
      await work();
    } catch (e) {
      setActionError(errorMessage(codeOf(e)));
    } finally {
      setBusyId(null);
    }
  };

  const open = (profileId: string) => act(profileId, async () => {
    const { profile, options, reading } = await openProfile(profileId);
    await saveLast({ profile, options, reading });
    router.push('/result?from=archive');
  });
  const change = (profileId: string, patch: { tag?: Tag | null; isPrimary?: boolean }) => act(profileId, async () => {
    await updateProfile(profileId, patch);
    await load();
  });
  const remove = (profileId: string) => act(profileId, async () => {
    await deleteProfile(profileId);
    setConfirmId(null);
    await load();
  });

  if (state.status === 'loading') return <View style={st.screen} />;

  if (state.status === 'login') {
    return (
      <View style={[st.screen, st.center]}>
        <View style={st.message}>
          <Text style={st.h2}>로그인하면 저장한 사주를 볼 수 있어요</Text>
          <Button label="Google로 로그인" onPress={() => startGoogleLogin('/archive')} />
        </View>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[st.screen, st.center]}>
        <View style={st.message}>
          <ErrorText>{state.message}</ErrorText>
          <Button variant="secondary" label="다시 불러오기" onPress={() => { setState({ status: 'loading' }); load(); }} />
        </View>
      </View>
    );
  }

  const { profiles, limit } = state;
  const shown = filter === 'ALL' ? profiles : profiles.filter(p => p.tag === filter);
  const filterOptions = [
    { value: 'ALL' as const, label: `전체 ${profiles.length}` },
    ...TAGS.map(t => ({ value: t.code, label: `${t.label} ${profiles.filter(p => p.tag === t.code).length}` })),
  ];

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.page}>
      <View style={st.column}>
        <View style={st.head}>
          <Text style={st.h2}>
            저장한 사주 <Text style={st.count}>{profiles.length}/{limit}</Text>
          </Text>
          <Button variant="secondary" label="새 사주 입력" onPress={() => router.push('/input')} />
        </View>

        {profiles.length > 0 && <ChoiceChips label="태그로 거르기" options={filterOptions} value={filter} onChange={setFilter} />}
        <ErrorText>{actionError}</ErrorText>

        {profiles.length === 0 ? (
          <View style={st.card}>
            <Text style={st.body}>아직 저장한 사주가 없습니다.</Text>
            <Text style={st.meta}>결과 화면에서 "보관함에 저장"을 누르면 여기에 모입니다.</Text>
          </View>
        ) : shown.length === 0 ? (
          <View style={st.card}>
            <Text style={st.body}>이 태그로 저장한 사주가 없습니다.</Text>
          </View>
        ) : (
          shown.map(p => {
            const busy = busyId === p.profileId;
            const editing = editId === p.profileId;
            const confirming = confirmId === p.profileId;
            const date = `${p.calendar === 'LUNAR' ? `음력${p.isLeapMonth ? ' 윤달' : ''}` : '양력'} ${p.birthDate.replaceAll('-', '.')} ${p.birthTime ?? '시간 모름'}`;
            const tag = tagLabel(p.tag);
            return (
              <View key={p.profileId} style={[st.card, p.isPrimary && st.cardPrimary]}>
                <Pressable
                  onPress={() => open(p.profileId)} disabled={busy} style={st.item} accessibilityRole="button"
                  accessibilityLabel={`${p.isPrimary ? '대표 사주, ' : ''}${tag ? `${tag}, ` : ''}${p.name || '이름 없음'} 사주 열기, ${date}`}
                >
                  <View style={st.nameRow}>
                    <Text style={st.name}>{p.name || '이름 없음'} <Text style={st.meta}>· {p.gender === 'F' ? '여' : '남'}</Text></Text>
                    {p.isPrimary && <Chip label="대표" />}
                    {tag && <Chip label={tag} />}
                  </View>
                  <Text style={st.meta}>{date} · {regionName(p.regionCode)}</Text>
                  <Text style={st.body}>
                    {p.dayPillar}일주 · {p.currentDaewoon ? `지금 ${p.currentDaewoon} 대운` : '대운 시작 전'}
                  </Text>
                </Pressable>

                {editing && (
                  <View style={st.edit}>
                    <Text style={st.label}>태그</Text>
                    <ChoiceChips<Tag | null>
                      label="태그" value={p.tag} disabled={busy}
                      options={[{ value: null, label: '없음' }, ...TAGS.map(t => ({ value: t.code, label: t.label }))]}
                      onChange={value => change(p.profileId, { tag: value })}
                    />
                    <View style={st.primaryRow}>
                      <Text style={[st.meta, st.grow]}>
                        {p.isPrimary ? '대표 사주입니다. 첫 화면에 보여요.' : '대표 사주는 첫 화면에 보여요. 하나만 지정할 수 있어요.'}
                      </Text>
                      <Button
                        variant="secondary" label={p.isPrimary ? '대표 해제' : '대표로 지정'}
                        onPress={() => change(p.profileId, { isPrimary: !p.isPrimary })} loading={busy} loadingLabel="바꾸는 중…"
                      />
                    </View>
                  </View>
                )}

                <View style={st.actions}>
                  {confirming ? (
                    <>
                      <Text style={[st.meta, st.grow]}>이 사주를 보관함에서 지울까요?</Text>
                      <Button variant="secondary" label="취소" onPress={() => setConfirmId(null)} disabled={busy} />
                      <Button label="삭제" onPress={() => remove(p.profileId)} loading={busy} loadingLabel="삭제 중…" />
                    </>
                  ) : (
                    <>
                      <View style={st.grow}>
                        <Button label="열기" onPress={() => open(p.profileId)} loading={busy && !editing} loadingLabel="여는 중…" />
                      </View>
                      <Button
                        variant="secondary" label={editing ? '닫기' : '태그·대표'}
                        onPress={() => setEditId(editing ? null : p.profileId)} disabled={busy}
                      />
                      <Button variant="secondary" label="삭제" onPress={() => { setEditId(null); setConfirmId(p.profileId); }} disabled={busy} />
                    </>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { width: '100%', maxWidth: 420, gap: 16, alignItems: 'stretch' },
  page: { padding: 20, paddingBottom: 48 },
  column: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  h2: { fontSize: 20, fontWeight: '700', color: C.ink },
  count: { fontSize: 15, fontWeight: '500', color: C.ink2, fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.surface, borderRadius: 12, padding: 16, gap: 12, borderWidth: 1, borderColor: C.surface },
  cardPrimary: { borderColor: C.ink },
  item: { gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  name: { fontSize: 17, fontWeight: '700', color: C.ink },
  label: { fontSize: 13, fontWeight: '600', color: C.ink },
  meta: { fontSize: 13, color: C.ink2, lineHeight: 19, fontVariant: ['tabular-nums'] },
  body: { fontSize: 15, color: C.ink, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center', backgroundColor: C.tint },
  choiceOn: { backgroundColor: C.ink },
  choiceText: { fontSize: 14, color: C.ink2, fontWeight: '500', fontVariant: ['tabular-nums'] },
  choiceTextOn: { color: C.surface, fontWeight: '600' },
  edit: { gap: 10, backgroundColor: C.ground, borderRadius: 10, padding: 12 },
  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.ruleSoft, paddingTop: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: C.ruleSoft, paddingTop: 12 },
});

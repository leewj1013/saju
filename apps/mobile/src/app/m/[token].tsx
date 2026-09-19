// 궁합 결과 공유 열람: 로그인 없이 보고, "나도 궁합 보기"로 유도
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, C } from '../../components/ui';
import { ReadingError, openMatchShare, track } from '../../lib/saju';
import type { MatchResult } from '../../lib/saju';
import { MatchBody } from '../match-result';

export default function SharedMatchScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [shared, setShared] = useState<MatchResult>();
  const [failed, setFailed] = useState<'NOT_FOUND' | 'OTHER'>();

  useEffect(() => {
    openMatchShare(token)
      .then(s => {
        setShared(s);
        track('match_view', { relation: s.relation });
      })
      .catch(e => setFailed(e instanceof ReadingError && e.errors[0]?.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'OTHER'));
  }, [token]);

  if (failed) {
    return (
      <View style={st.empty}>
        <Text style={st.h2}>{failed === 'NOT_FOUND' ? '열 수 없는 링크입니다' : '결과를 불러오지 못했습니다'}</Text>
        <Text style={st.body}>
          {failed === 'NOT_FOUND'
            ? '공유한 지 30일이 지났거나, 공유한 사람이 사주를 삭제했을 수 있어요.'
            : '인터넷 연결을 확인하고 다시 열어 주세요.'}
        </Text>
        <Button label="나도 궁합 보기" onPress={() => router.replace('/match')} />
      </View>
    );
  }
  if (!shared) return <View style={st.screen} />;
  return (
    <MatchBody
      result={shared}
      names={[shared.names[0] || '첫 번째 사람', shared.names[1] || '두 번째 사람']}
      actions={<Button label="나도 궁합 보기" onPress={() => router.replace('/match')} />}
    />
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.ground },
  empty: { flex: 1, backgroundColor: C.ground, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  h2: { fontSize: 20, fontWeight: '700', color: C.ink, textAlign: 'center' },
  body: { fontSize: 15, color: C.ink2, lineHeight: 23, textAlign: 'center', maxWidth: 360 },
});

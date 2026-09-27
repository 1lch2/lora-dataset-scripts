import { useMemo, useState } from 'react';
import type { FieldName, ReviewFields } from './types';
import type { Source, TagImage } from '../../api/types';
import { imageKey, sortedCounts, splitTags, tagContains, tagMatcher } from './utils';

export function useTags(
  sources: Source[],
  fields: ReviewFields,
  setField: (name: FieldName, value: string) => void,
) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [singleKey, setSingleKey] = useState<string>();
  const [imageFilter, setImageFilter] = useState<Set<string> | null>(null);
  const [imageBasket, setImageBasket] = useState<Set<string>>(new Set());
  const [clickedTags, setClickedTags] = useState<Set<string>>(new Set());
  const {
    allImages,
    filteredSources,
    visibleTags,
    focused,
    selections,
    targets,
    counts,
    common,
    vocabularyMatch,
    frequencyMatch,
    focusedTags,
    vocabulary,
    frequencies,
    basket,
    filterCount,
    outside,
  } = useMemo(() => {
    const allImages = sources.flatMap((s) =>
      s.candidates.filter((c) => c.status === 'accepted' && c.tag).map((c) => [s, c] as TagImage),
    );
    const filteredSources = sources.filter(
      (s) =>
        (!fields.group || s.group === fields.group) &&
        s.relative.toLowerCase().includes(fields.search.toLowerCase()),
    );
    const baseImages = allImages.filter(
      ([s, c]) =>
        filteredSources.includes(s) &&
        (!fields.kind || c.kind === fields.kind) &&
        (imageFilter === null || imageFilter.has(imageKey(s, c))),
    );
    const positive = splitTags(fields.hasTag),
      negative = splitTags(fields.notTag);
    const visibleTags = baseImages.filter(([, c]) => {
      const matches = (terms: string[]) => terms.map((t) => c.tag.tags.some((tag) => tagContains(tag, t)));
      if (
        positive.length &&
        !(fields.hasLogic === 'all' ? matches(positive).every(Boolean) : matches(positive).some(Boolean))
      )
        return false;
      if (
        negative.length &&
        (fields.notLogic === 'all' ? matches(negative).every(Boolean) : matches(negative).some(Boolean))
      )
        return false;
      return true;
    });
    const focused = visibleTags.find(([s, c]) => imageKey(s, c) === singleKey);
    const selections = allImages
      .filter(([s, c]) => c.tag_current && selected.has(imageKey(s, c)))
      .map(([s, c]) => [s.id, c.id]);
    const targets =
      fields.editScope === 'filtered'
        ? visibleTags.filter(([, c]) => c.tag_current).map(([s, c]) => [s.id, c.id])
        : selections;
    const counts = new Map<string, number>();
    baseImages.forEach(([, c]) =>
      new Set(c.tag.tags).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)),
    );
    const common = new Map<string, number>();
    allImages
      .filter(([s, c]) => targets.some(([sid, cid]) => sid === s.id && cid === c.id))
      .forEach(([, c]) => new Set(c.tag.tags).forEach((t) => common.set(t, (common.get(t) || 0) + 1)));
    const vocabularyMatch = tagMatcher(fields.tagSearch.trim(), fields.tagSearchMode);
    const frequencyMatch = tagMatcher(fields.frequencySearch.trim(), fields.frequencySearchMode);
    const focusedTags = focused ? new Set(focused[1].tag.tags) : null;
    const vocabulary = sortedCounts(counts, fields.tagSort, fields.tagOrder).filter(
      ([t]) =>
        (!focusedTags || focusedTags.has(t)) &&
        vocabularyMatch.match(t) &&
        (!positive.length || positive.some((term) => tagContains(t, term))),
    );
    const frequencies = sortedCounts(counts, fields.frequencySort, fields.frequencyOrder).filter(
      ([t]) => frequencyMatch.match(t) && (!positive.length || positive.some((term) => tagContains(t, term))),
    );
    const basket = allImages.filter(([s, c]) => imageBasket.has(imageKey(s, c)));
    const filterCount = allImages.filter(([s, c]) => imageFilter?.has(imageKey(s, c))).length;
    const outside = targets.filter(
      ([s, c]) => !visibleTags.some(([vs, vc]) => vs.id === s && vc.id === c),
    ).length;
    return {
      allImages,
      filteredSources,
      visibleTags,
      focused,
      selections,
      targets,
      counts,
      common,
      vocabularyMatch,
      frequencyMatch,
      focusedTags,
      vocabulary,
      frequencies,
      basket,
      filterCount,
      outside,
    };
  }, [sources, fields, selected, singleKey, imageFilter, imageBasket]);
  function handleToggleFilter(name: 'hasTag' | 'notTag', tag: string) {
    const tags = splitTags(fields[name]);
    const remove = name === 'hasTag' ? clickedTags.has(tag) : tags.includes(tag);
    if (name === 'hasTag')
      setClickedTags((previous) => {
        const next = new Set(previous);
        if (remove) next.delete(tag);
        else next.add(tag);
        return next;
      });
    setField(name, (remove ? tags.filter((t) => t !== tag) : [...new Set([...tags, tag])]).join(', '));
  }
  function handleFocus(pair?: TagImage) {
    setSingleKey(pair ? imageKey(...pair) : undefined);
    setField('singleCaption', pair ? pair[1].tag.tags.join(', ') : '');
  }
  return {
    selected,
    setSelected,
    singleKey,
    focused,
    handleFocus,
    setSingleKey,
    imageFilter,
    setImageFilter,
    imageBasket,
    setImageBasket,
    clickedTags,
    setClickedTags,
    allImages,
    filteredSources,
    visibleTags,
    selections,
    targets,
    counts,
    commonTags:
      [...common]
        .filter(([, n]) => n === targets.length)
        .map(([t]) => t)
        .join(', ') || '无',
    vocabulary,
    frequencies,
    vocabularyError: vocabularyMatch.error,
    frequencyError: frequencyMatch.error,
    vocabularyTotal: focusedTags ? focusedTags.size : counts.size,
    basket,
    filterCount,
    outside,
    handleToggleFilter,
  };
}

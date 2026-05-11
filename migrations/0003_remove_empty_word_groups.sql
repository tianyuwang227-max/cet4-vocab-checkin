DELETE FROM word_groups
WHERE id NOT IN (
  SELECT DISTINCT group_id
  FROM words
);

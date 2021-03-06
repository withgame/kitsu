import {
  buildNameIndex,
  indexSearch
} from './indexing'

const EQUAL_REGEX = /([^ ]*)=\[([^[]*)\]|([^ ]*)=([^ ]*)|\[([^[]*)\]=([^ ]*)/g

/*
 * Look in the search query for task type filter like anim=wip.
 * Then apply filters found on result list.
 */
export const applyFilters = (entries, filters, taskMap) => {
  const isStatus = { status: true }
  const isAssignation = { assignation: true }
  const isExclusion = { exclusion: true }
  const isDescriptor = { descriptor: true }
  const isAvatar = { thumbnail: true }
  const isAssignedTo = { assignedto: true }

  if (filters && filters.length > 0) {
    return entries.filter((entry) => {
      let isOk = true
      filters.forEach((filter) => {
        let task = null
        if (!isOk) return false

        if (filter.taskType && entry.validations[filter.taskType.id]) {
          task = taskMap[entry.validations[filter.taskType.id]]
        }
        if (isStatus[filter.type]) {
          isOk = task && task.task_status_id === filter.taskStatus.id
          if (filter.excluding) isOk = !isOk
        } else if (isAssignation[filter.type]) {
          if (filter.assigned) {
            isOk = task && task.assignees && task.assignees.length > 0
          } else {
            isOk = !task ||
              (task && task.assignees && task.assignees.length === 0)
          }
        } else if (isExclusion[filter.type]) {
          isOk = !filter.excludedIds[entry.id]
        } else if (isDescriptor[filter.type]) {
          if (
            entry.data &&
            entry.data[filter.descriptor.field_name] &&
            filter.value
          ) {
            let dataValue = entry.data[filter.descriptor.field_name]
            dataValue = dataValue.toLowerCase()
            isOk = dataValue.indexOf(filter.value.toLowerCase()) >= 0
          } else {
            isOk = false
          }
          if (filter.excluding) isOk = !isOk
        } else if (isAvatar[filter.type]) {
          const hasAvatar =
            entry.preview_file_id !== '' &&
            entry.preview_file_id !== undefined &&
            entry.preview_file_id !== null
          isOk = filter.excluding ? !hasAvatar : hasAvatar
        } else if (isAssignedTo[filter.type]) {
          isOk = false
          if (entry.tasks) {
            entry.tasks.forEach((taskId) => {
              task = taskMap[taskId]
              isOk = isOk || task.assignees.includes(filter.personId)
            })
          }
          if (filter.excluding) isOk = !isOk
        }
      })
      return isOk
    })
  } else {
    return entries
  }
}

/**
 * Extract keywords from a given text. Remove equality and exclusion
 * expressions.
 */
export const getKeyWords = (queryText) => {
  if (!queryText) {
    return []
  } else {
    return queryText
      .replace(EQUAL_REGEX, '')
      .split(' ')
      .filter((query) => {
        return query.length > 0 && query[0] !== '-' && query !== 'withthumbnail'
      })
  }
}

/**
 * Extract excluding keywords from a given text. Remove equality expresions
 * and tradition keywords.
 */
export const getExcludingKeyWords = (queryText) => {
  return queryText
    .replace(EQUAL_REGEX, '')
    .split(' ')
    .filter((keyword) => {
      return (
        keyword.length > 0 && keyword[0] === '-' && keyword !== '-withthumbnail'
      )
    })
    .map(keyword => keyword.substring(1))
}

/*
 * Build all filters data struct generated by a query and return them as
 * an array. It includes:
 * * status filters
 * * assignation filters
 * * exclusion filters
 */
export const getFilters = (
  entryIndex, taskTypes, taskStatuses, descriptors, persons, query
) => {
  let filters = getTaskTypeFilters(taskTypes, taskStatuses, query)
  const descFilters = getDescFilters(descriptors, query)
  const assignedToFilters = getAssignedToFilters(persons, query)
  const thumbnailFilters = getThumbnailFilters(query) || []
  const excludingKeywords = getExcludingKeyWords(query) || []
  filters = filters
    .concat(descFilters)
    .concat(thumbnailFilters)
    .concat(assignedToFilters)
  excludingKeywords.forEach((keyword) => {
    const excludedMap = {}
    const excludedEntries = indexSearch(entryIndex, [keyword]) || []
    excludedEntries.forEach((entry) => {
      excludedMap[entry.id] = true
    })
    filters.push({
      type: 'exclusion',
      excludedIds: excludedMap
    })
  })
  return filters
}

/*
 *  Extract filters from a query dedicated to task list.
 */
export const getTaskFilters = (entryIndex, query) => {
  const filters = []
  const excludingKeywords = getExcludingKeyWords(query) || []
  excludingKeywords.forEach((keyword) => {
    const excludedMap = {}
    const excludedEntries = indexSearch(entryIndex, [keyword]) || []
    excludedEntries.forEach((entry) => {
      excludedMap[entry.id] = true
    })
    filters.push({
      type: 'exclusion',
      excludedIds: excludedMap
    })
  })
  return filters
}

/*
 * Extract task type filters (like anim=wip or [mode facial]=wip) from given
 * query.
 */
export const getTaskTypeFilters = (
  taskTypes,
  taskStatuses,
  queryText
) => {
  if (!queryText) return []

  const results = []
  const rgxMatches = queryText.match(EQUAL_REGEX)

  if (rgxMatches) {
    const taskTypeNameIndex = buildNameIndex(taskTypes, false)
    const taskStatusShortNameIndex = {}
    taskStatuses.forEach((taskStatus) => {
      const shortName = taskStatus.short_name.toLowerCase()
      taskStatusShortNameIndex[shortName] = taskStatus
    })
    rgxMatches.forEach((rgxMatch) => {
      const pattern = rgxMatch.split('=')
      let value = pattern[1]
      const excluding = value.startsWith('-')
      if (excluding) value = value.substring(1)
      let taskTypeName = pattern[0]
      if (taskTypeName[0] === '[') {
        taskTypeName = taskTypeName.substring(1, taskTypeName.length - 1)
      }
      const taskTypes = taskTypeNameIndex[taskTypeName.toLowerCase()]
      if (taskTypes) {
        if (value === 'unassigned') {
          results.push({
            taskType: taskTypes[0],
            assigned: false,
            type: 'assignation'
          })
        } else if (value === 'assigned') {
          results.push({
            taskType: taskTypes[0],
            assigned: true,
            type: 'assignation'
          })
        } else if (value && taskStatusShortNameIndex[value.toLowerCase()]) {
          results.push({
            taskType: taskTypes[0],
            taskStatus: taskStatusShortNameIndex[value.toLowerCase()],
            type: 'status',
            excluding
          })
        }
      }
    })
  }
  return results
}

/*
 * Extract metadata filters (like size=big or size=small) from given
 * query.
 */
export const getDescFilters = (descriptors, queryText) => {
  if (!queryText) return []

  const results = []
  const rgxMatches = queryText.match(EQUAL_REGEX)

  if (rgxMatches) {
    const descriptorNameIndex = buildNameIndex(descriptors, false)
    rgxMatches.forEach((rgxMatch) => {
      const pattern = rgxMatch.split('=')
      let value = pattern[1]
      let descriptorName = pattern[0]
      if (descriptorName[0] === '[') {
        descriptorName = descriptorName.substring(1, descriptorName.length - 1)
      }
      const matchedDescriptors =
        descriptorNameIndex[descriptorName.toLowerCase()]
      const excluding = value.startsWith('-')
      if (excluding) value = value.substring(1)
      if (matchedDescriptors) {
        results.push({
          descriptor: matchedDescriptors[0],
          value,
          type: 'descriptor',
          excluding
        })
      }
    })
  }
  return results
}

/*
 * Extract person filters (like size=big or size=small) from given
 * query.
 */
export const getAssignedToFilters = (persons, queryText) => {
  if (!queryText) return []

  const results = []
  const rgxMatches = queryText.match(EQUAL_REGEX)
  if (rgxMatches) {
    rgxMatches.forEach((rgxMatch) => {
      const personIndex = new Map()
      persons.forEach(person => {
        const name = person.name.toLowerCase()
        personIndex.set(name, person)
      })
      const pattern = rgxMatch.split('=')
      if (pattern[0] === 'assignedto') {
        let value = pattern[1]
        if (value[0] === '[') {
          value = value.substring(1, value.length - 1)
        }
        const excluding = value.startsWith('-')
        if (excluding) value = value.substring(1)
        const person = personIndex.get(value.toLowerCase())
        if (person) {
          results.push({
            personId: person.id,
            value,
            type: 'assignedto',
            excluding
          })
        }
      }
    })
  }
  return results
}

export const getThumbnailFilters = (queryText) => {
  const results = []
  if (queryText.indexOf('-withthumbnail') > -1) {
    results.push({
      type: 'thumbnail',
      excluding: true
    })
  } else if (queryText.indexOf('withthumbnail') > -1) {
    results.push({
      type: 'thumbnail',
      excluding: false
    })
  }
  return results
}

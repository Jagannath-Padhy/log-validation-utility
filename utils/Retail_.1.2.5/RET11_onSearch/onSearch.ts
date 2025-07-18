/* eslint-disable no-case-declarations */
/* eslint-disable no-prototype-builtins */
import { logger } from '../../../shared/logger'
import { setValue, getValue } from '../../../shared/dao'
import constants, { ApiSequence } from '../../../constants'
import {
  validateSchemaRetailV2,
  isObjectEmpty,
  checkContext,
  // timeDiff as timeDifference,
  checkGpsPrecision,
  emailRegex,
  checkBppIdOrBapId,
  checkServiceabilityType,
  validateLocations,
  // isSequenceValid,
  isValidPhoneNumber,
  compareSTDwithArea,
  areTimestampsLessThanOrEqualTo,
  validateObjectString,
  validateBapUri,
  validateBppUri,
  validateMetaTags,
  validateNpFees,
} from '../..'
import _, { isEmpty } from 'lodash'
import {
  calculateDefaultSelectionPrice,
  extractCustomGroups,
  mapCustomItemToTreeNode,
  mapCustomizationsToBaseItems,
  mapItemToTreeNode,
} from './fb_calculation/default_selection/utils'
import { FLOW } from '../../enum'
// import { MenuTreeBuilder } from './fb_calculation/lower_upper_range/builder'
// import { CatalogParser } from './fb_calculation/lower_upper_range/parser'

export const checkOnsearchFullCatalogRefresh = (data: any,flow:string) => {
  if (!data || isObjectEmpty(data)) {
    return { [ApiSequence.ON_SEARCH]: 'JSON cannot be empty' }
  }

  const { message, context } = data
  if (!message || !context || !message.catalog || isObjectEmpty(message) || isObjectEmpty(message.catalog)) {
    return { missingFields: '/context, /message, /catalog or /message/catalog is missing or empty' }
  }

  const schemaValidation = validateSchemaRetailV2('RET11', constants.ON_SEARCH, data)

  const contextRes: any = checkContext(context, constants.ON_SEARCH)
  setValue(`${ApiSequence.ON_SEARCH}_context`, context)
  setValue(`${ApiSequence.ON_SEARCH}_message`, message)
  let errorObj: any = {}

  if (schemaValidation !== 'error') {
    Object.assign(errorObj, schemaValidation)
  }

  try {
    logger.info(`Comparing Message Ids of /${constants.SEARCH} and /${constants.ON_SEARCH}`)
    if (!_.isEqual(getValue(`${ApiSequence.SEARCH}_msgId`), context.message_id)) {
      errorObj[`${ApiSequence.ON_SEARCH}_msgId`] =
        `Message Ids for /${constants.SEARCH} and /${constants.ON_SEARCH} api should be same`
    }
  } catch (error: any) {
    logger.error(`!!Error while checking message id for /${constants.ON_SEARCH}, ${error.stack}`)
  }

  if (!_.isEqual(data.context.domain.split(':')[1], getValue(`domain`))) {
    errorObj[`Domain[${data.context.action}]`] = `Domain should be same in each action`
  }

  const checkBap = checkBppIdOrBapId(context.bap_id)
  const checkBpp = checkBppIdOrBapId(context.bpp_id)

  if (checkBap) Object.assign(errorObj, { bap_id: 'context/bap_id should not be a url' })
  if (checkBpp) Object.assign(errorObj, { bpp_id: 'context/bpp_id should not be a url' })
  if (!contextRes?.valid) {
    Object.assign(errorObj, contextRes.ERRORS)
  }

  validateBapUri(context.bap_uri, context.bap_id, errorObj)
  validateBppUri(context.bpp_uri, context.bpp_id, errorObj)

  if (context.transaction_id == context.message_id) {
    errorObj['on_search_full_catalog_refresh'] =
      `Context transaction_id (${context.transaction_id}) and message_id (${context.message_id}) can't be the same.`
  }

  setValue(`${ApiSequence.ON_SEARCH}`, data)

  const searchContext: any = getValue(`${ApiSequence.SEARCH}_context`)

  try {
    logger.info(`Storing BAP_ID and BPP_ID in /${constants.ON_SEARCH}`)
    setValue('bapId', context.bap_id)
    setValue('bppId', context.bpp_id)
  } catch (error: any) {
    logger.error(`!!Error while storing BAP and BPP Ids in /${constants.ON_SEARCH}, ${error.stack}`)
  }

  try {
    logger.info(`Comparing timestamp of /${ApiSequence.SEARCH} /${constants.ON_SEARCH}`)

    if (searchContext.timestamp == context.timestamp) {
      errorObj.tmstmp = `context/timestamp of /${constants.SEARCH} and /${constants.ON_SEARCH} api cannot be same`
    }
  } catch (error: any) {
    logger.error(`!!Error while Comparing timestamp of /${ApiSequence.SEARCH} /${constants.ON_SEARCH}, ${error.stack}`)
  }

  try {
    logger.info(`Comparing transaction Ids of /${constants.SEARCH} and /${constants.ON_SEARCH}`)
    if (!_.isEqual(searchContext.transaction_id, context.transaction_id)) {
      errorObj.transaction_id = `Transaction Id for /${constants.SEARCH} and /${constants.ON_SEARCH} api should be same`
    }
  } catch (error: any) {
    logger.info(
      `Error while comparing transaction ids for /${constants.SEARCH} and /${constants.ON_SEARCH} api, ${error.stack}`,
    )
  }
  try {
    logger.info(`Checking customizations based on config.min and config.max values...`)

    const items = getValue('items') // Retrieve items from the catalog or message

    _.filter(items, (item) => {
      const customGroup = item.custom_group // Assuming custom_group holds the configuration data

      // Check for minimum customizations
      if (customGroup?.config?.min === 1) {
        logger.info(`Checking min value for item id: ${item.id}`)

        const defaultCustomizations = _.filter(item.customizations, (customization) => {
          return customization.is_default // Check for default customizations
        })

        if (defaultCustomizations.length < 1) {
          const key = `item${item.id}CustomGroup/min`
          errorObj[key] =
            `Item with id: ${item.id} must have at least one default customization as config.min is set to 1.`
        }
      }

      // Check for maximum customizations
      if (customGroup?.config?.max === 2) {
        logger.info(`Checking max value for item id: ${item.id}`)

        const customizationsCount = item.customizations.length

        if (customizationsCount > 2) {
          const key = `item${item.id}CustomGroup/max`
          errorObj[key] = `Item with id: ${item.id} can have at most 2 customizations as config.max is set to 2.`
        }
      }
    })
  } catch (error: any) {
    logger.error(`Error while checking customizations for items, ${error.stack}`)
  }

  // removed timestamp difference check
  // try {
  //   logger.info(`Comparing timestamp of /${constants.SEARCH} and /${constants.ON_SEARCH}`)
  //   const tmpstmp = searchContext?.timestamp
  //   if (_.gte(tmpstmp, context.timestamp)) {
  //     errorObj.tmpstmp = `Timestamp for /${constants.SEARCH} api cannot be greater than or equal to /${constants.ON_SEARCH} api`
  //   } else {
  //     const timeDiff = timeDifference(context.timestamp, tmpstmp)
  //     logger.info(timeDiff)
  //     if (timeDiff > 5000) {
  //       errorObj.tmpstmp = `context/timestamp difference between /${constants.ON_SEARCH} and /${constants.SEARCH} should be less than 5 sec`
  //     }
  //   }
  // } catch (error: any) {
  //   logger.info(
  //     `Error while comparing timestamp for /${constants.SEARCH} and /${constants.ON_SEARCH} api, ${error.stack}`,
  //   )
  // }

  try {
    logger.info(`Comparing Message Ids of /${constants.SEARCH} and /${constants.ON_SEARCH}`)
    if (!_.isEqual(searchContext.message_id, context.message_id)) {
      errorObj.message_id = `Message Id for /${constants.SEARCH} and /${constants.ON_SEARCH} api should be same`
    }
  } catch (error: any) {
    logger.info(
      `Error while comparing message ids for /${constants.SEARCH} and /${constants.ON_SEARCH} api, ${error.stack}`,
    )
  }

  const onSearchCatalog: any = message.catalog
  const onSearchFFIdsArray: any = []
  const prvdrsId = new Set()
  const prvdrLocId = new Set()
  const onSearchFFTypeSet = new Set()
  const itemsId = new Set()
  let customMenuIds: any = []
  let customMenu = false
  // Storing static fulfillment ids in onSearchFFIdsArray, OnSearchFFTypeSet
  try {
    logger.info(`Saving static fulfillment ids in /${constants.ON_SEARCH}`)

    onSearchCatalog['bpp/providers'].forEach((provider: any) => {
      const onSearchFFIds = new Set()
      const bppFF = provider.fulfillments
      const len = bppFF.length

      let i = 0
      while (i < len) {
        onSearchFFTypeSet.add(bppFF[i].type)
        onSearchFFIds.add(bppFF[i].id)
        i++
      }
      onSearchFFIdsArray.push(onSearchFFIds)
    })

    setValue('onSearchFFIdsArray', onSearchFFIdsArray)
  } catch (error: any) {
    logger.info(`Error while saving static fulfillment ids in /${constants.ON_SEARCH}, ${error.stack}`)
  }

  try {
    logger.info(`Checking for upcoming holidays`)
    const location = onSearchCatalog['bpp/providers'][0]['locations']
    if (!location) {
      logger.error('No location detected ')
    }

    const scheduleObject = location[0].time.schedule.holidays
    const timestamp = context.timestamp
    const [currentDate] = timestamp.split('T')

    scheduleObject.map((date: string) => {
      const dateObj = new Date(date)
      const currentDateObj = new Date(currentDate)
      if (dateObj.getTime() < currentDateObj.getTime()) {
        const key = `/message/catalog/bpp/providers/loc${0}/time/schedule/holidays`
        errorObj[key] = `Holidays cannot be past ${currentDate}`
      }
    })
  } catch (e) {
    logger.error('No Holiday', e)
  }

  try {
    logger.info(`Mapping items with thier respective providers`)
    const itemProviderMap: any = {}
    const providers = onSearchCatalog['bpp/providers']
    providers.forEach((provider: any) => {
      const items = provider.items
      const itemArray: any = []
      items.forEach((item: any) => {
        itemArray.push(item.id)
      })
      itemProviderMap[provider.id] = itemArray
    })

    setValue('itemProviderMap', itemProviderMap)
  } catch (e: any) {
    logger.error(`Error while mapping items with thier respective providers ${e.stack}`)
  }

  try {
    logger.info(`Storing Item IDs in /${constants.ON_SEARCH}`)
    const providers = onSearchCatalog['bpp/providers']
    providers.forEach((provider: any, index: number) => {
      const items = provider.items
      items.forEach((item: any, j: number) => {
        if (itemsId.has(item.id)) {
          const key = `DuplicateItem[${j}]`
          errorObj[key] = `duplicate item id: ${item.id} in bpp/providers[${index}]`
        } else {
          itemsId.add(item.id)
        }
      })
    })
  } catch (error: any) {
    logger.error(`Error while storing Item IDs in /${constants.ON_SEARCH}, ${error.stack}`)
  }

  try {
    logger.info(`Checking for np_type in bpp/descriptor`)
    const descriptor = onSearchCatalog['bpp/descriptor']
    descriptor?.tags.map((tag: { code: any; list: any[] }) => {
      if (tag.code === 'bpp_terms') {
        const npType = tag.list.find((item) => item.code === 'np_type')
        if (!npType) {
          errorObj['bpp/descriptor'] = `Missing np_type in bpp/descriptor`
          setValue(`${ApiSequence.ON_SEARCH}np_type`, '')
        } else {
          setValue(`${ApiSequence.ON_SEARCH}np_type`, npType.value)
          const npTypeValue = npType.value
          if (npTypeValue !== 'ISN' && npTypeValue !== 'MSN') {
            errorObj['bpp/descriptor/np_type'] =
              `Invalid value '${npType.value}' for np_type. It should be either 'ISN' or 'MSN' in uppercase.`
          }
        }

        const accept_bap_terms = tag.list.find((item) => item.code === 'accept_bap_terms')
        if (accept_bap_terms) {
          errorObj['bpp/descriptor/accept_bap_terms'] =
            `remove accept_bap_terms block in /bpp/descriptor/tags; should be enabled once BNP send their static terms in /search and are later accepted by SNP`
        }

        const collect_payment = tag.list.find((item) => item.code === 'collect_payment')
        if (collect_payment) {
          errorObj['bpp/descriptor/collect_payment'] = `collect_payment is not required in bpp/descriptor/tags `
        }
      }
    })
  } catch (error: any) {
    logger.error(`Error while checking np_type in bpp/descriptor for /${constants.ON_SEARCH}, ${error.stack}`)
  }

  try {
    logger.info(`Checking Providers info (bpp/providers) in /${constants.ON_SEARCH}`)
    let i = 0
    const bppPrvdrs = onSearchCatalog['bpp/providers']
    const len = bppPrvdrs.length
    const tmpstmp = context.timestamp
    let itemIdList: any = []
    let itemsArray = []
    while (i < len) {
      const categoriesId = new Set()
      const customGrpId = new Set()
      const seqSet = new Set()
      const itemCategory_id = new Set()
      const categoryRankSet = new Set()
      const prvdrLocationIds = new Set()

      logger.info(`Validating uniqueness for provider id in bpp/providers[${i}]...`)
      const prvdr = bppPrvdrs[i]
      const categories = prvdr?.['categories']
      const items = prvdr?.['items']

      if (prvdrsId.has(prvdr.id)) {
        const key = `prvdr${i}id`
        errorObj[key] = `duplicate provider id: ${prvdr.id} in bpp/providers`
      } else {
        prvdrsId.add(prvdr.id)
      }

      logger.info(`Checking store enable/disable timestamp in bpp/providers[${i}]`)
      const providerTime = new Date(prvdr.time.timestamp).getTime()
      const contextTimestamp = new Date(tmpstmp).getTime()
      setValue('tmpstmp', context.timestamp)

      if (providerTime > contextTimestamp) {
        errorObj.StoreEnableDisable = `store enable/disable timestamp (/bpp/providers/time/timestamp) should be less then or equal to context.timestamp`
      }

      try {
        const customGroupCategory = extractCustomGroups(categories)

        const baseTreeNodes = mapItemToTreeNode(items)

        const customItems = mapCustomItemToTreeNode(items, customGroupCategory)

        const mapItems = mapCustomizationsToBaseItems(baseTreeNodes, customItems)

        const default_selection = calculateDefaultSelectionPrice(mapItems)

        default_selection.forEach(({ base_item, default_selection_calculated, default_selection_actual }) => {
          if (
            !default_selection_calculated ||
            !default_selection_actual ||
            default_selection_calculated.min === undefined ||
            default_selection_actual.min === undefined ||
            default_selection_calculated.max === undefined ||
            default_selection_actual.max === undefined
          ) {
            const errorMessage = `Missing or invalid default_selection values for base_item ${base_item}.
            Calculated: ${JSON.stringify(default_selection_calculated)}, 
            Actual: ${JSON.stringify(default_selection_actual)}.`

            logger.error(`Error in base_item ${base_item}: ${errorMessage}`)
            errorObj[`providers[${i}][${base_item}]`] = errorMessage
            return
          }
          if (
            default_selection_calculated.min !== default_selection_actual.min ||
            default_selection_calculated.max !== default_selection_actual.max
          ) {
            const errorMessage = `Provided default_selection calculated incorrectly,
            Calculated: min=${default_selection_calculated.min}, max=${default_selection_calculated.max}. 
            Given: min=${default_selection_actual.min}, max=${default_selection_actual.max}.`

            logger.error(`Error in base_item ${base_item}: ${errorMessage}`)

            // Store error in errorObj with base_item as key
            errorObj[`providers[${i}][${base_item}]`] = errorMessage
          } else {
            logger.info(`Base item ${base_item} values match. No error.`)
          }
        })
      } catch (error: any) {
        errorObj[`providers[${i}_default_selection`] =
          `Error while Calculating Default Selection in /${constants.ON_SEARCH}, ${error.stack}`
        logger.info(`Error while Calculating Default Selection in /${constants.ON_SEARCH}, ${error.stack}`)
      }
      // commented price range calculation
      //       try {
      //         // Parse raw data
      //         const parsedCategories = CatalogParser.parseCategories(categories)
      //         const menuItems = CatalogParser.parseMenuItems(items)
      //         const customizations = CatalogParser.parseCustomizations(items)

      //         // Build menu trees with price calculations
      //         const treeBuilder = new MenuTreeBuilder(menuItems, parsedCategories, customizations)
      //         const itemsWithPricesAndLogs = treeBuilder.buildTrees()

      //         itemsWithPricesAndLogs.items.forEach((item: any) => {
      //           console.log("itemOkay", item)
      //           const calculatedPriceRange = item.priceRange
      //           const givenPriceRange = item.priceRangeGiven

      //           if (
      //             calculatedPriceRange.lower !== givenPriceRange.lower ||
      //             calculatedPriceRange.upper !== givenPriceRange.upper
      //           ) {
      //             const itemLog = CatalogParser.extractLogsForItem(itemsWithPricesAndLogs.logs, item.id)

      //             errorObj[`providers[${i}][lower_upper_range-(${item.id})`] =
      //               `Provided price range calculated incorrectly for ${item.id},
      // Calculated: lower=${calculatedPriceRange.lower}, upper=${calculatedPriceRange.upper}.
      // Given: lower=${givenPriceRange.lower}, upper=${givenPriceRange.upper}.
      // Calculation: ${itemLog}`
      //           }
      //         })
      //       } catch (error: any) {
      //         errorObj[`providers[${i}][lower_upper_range`] =
      //           `Error while Calculating Lower Upper Range in /${constants.ON_SEARCH}, ${error.stack}`
      //         logger.info(`Error while Calculating Lower Upper Range in /${constants.ON_SEARCH}, ${error.stack}`)
      //       }

      try {
        logger.info(`Checking length of strings provided in descriptor /${constants.ON_SEARCH}`)
        const descriptor = prvdr['descriptor']
        const result = validateObjectString(descriptor)
        if (typeof result == 'string' && result.length) {
          const key = `prvdr${i}descriptor`
          errorObj[key] = result
        }
      } catch (error: any) {
        logger.info(
          `Error while Checking length of strings provided in descriptor /${constants.ON_SEARCH}, ${error.stack}`,
        )
      }

      try {
        logger.info(`Checking for empty list arrays in tags`)
        const categories = prvdr['categories']
        categories.forEach(
          (category: { id: string; parent_category_id: string; descriptor: { name: string }; tags: any[] }) => {
            if (category.parent_category_id === category.id) {
              errorObj[`categories[${category.id}].prnt_ctgry_id`] =
                `/message/catalog/bpp/providers/categories/parent_category_id should not be the same as id in category '${category.descriptor.name}'`
            }
            category.tags.forEach((tag: { code: string; list: any[] }, index: number) => {
              if (tag.list.length === 0) {
                errorObj[`provider[${i}].categories[${category.id}].tags[${index}]`] =
                  `Empty list array provided for tag '${tag.code}' in category '${category.descriptor.name}'`
              }
              if (tag.code === 'display') {
                tag.list.forEach((item: { code: string; value: string }) => {
                  if (item.code === 'rank' && parseInt(item.value) === 0) {
                    errorObj[`provider[${i}].categories[${category.id}].tags[${index}].list[${item.code}]`] =
                      `display rank provided in /message/catalog/bpp/providers/categories (category:'${category?.descriptor?.name}) should not be zero ("0"), it should start from one ('1') '`
                  }
                })
              }
              if (tag.code === 'config') {
                tag.list.forEach((item: { code: string; value: string }) => {
                  if (item.code === 'seq' && parseInt(item.value) === 0) {
                    errorObj[`categories[${category.id}].tags[${index}].list[${item.code}]`] =
                      `Seq value should start from 1 and not 0 in category '${category.descriptor.name}'`
                  }
                })
              }
              if (tag.code === 'type') {
                tag.list.forEach((item: { code: string; value: string }) => {
                  if (item.code === 'type') {
                    if (
                      (category.parent_category_id == '' || category.parent_category_id) &&
                      item.value == 'custom_group'
                    ) {
                      if (category.parent_category_id) {
                        errorObj[`categories[${category.id}].tags[${index}].list[${item.code}]`] =
                          `parent_category_id should not have any value while type is ${item.value}`
                      }
                      errorObj[`categories[${category.id}].tags[${index}].list[${item.code}]`] =
                        `parent_category_id should not be present while type is ${item.value}`
                    } else if (
                      category.parent_category_id != '' &&
                      (item.value == 'custom_menu' || item.value == 'variant_group')
                    ) {
                      if (category.parent_category_id) {
                        errorObj[`categories[${category.id}].tags[${index}].list[${item.code}]`] =
                          `parent_category_id should be empty string while type is ${item.value}`
                      }
                      errorObj[`categories[${category.id}].tags[${index}].list[${item.code}]`] =
                        `parent_category_id should be present while type is ${item.value}`
                    } else if (
                      category.parent_category_id &&
                      (item.value == 'custom_menu' || item.value == 'variant_group')
                    ) {
                      if (category.parent_category_id) {
                        errorObj[`categories[${category.id}].tags[${index}].list[${item.code}]`] =
                          `parent_category_id should be empty string while type is ${item.value}`
                      }
                    }
                  }
                })
              }
            })
          },
        )
      } catch (error: any) {
        logger.error(`Error while checking empty list arrays in tags for /${constants.ON_SEARCH}, ${error.stack}`)
      }

      try {
        // Adding items in a list
        const items = prvdr.items
        itemsArray.push(items)
        items.forEach((item: any) => {
          itemIdList.push(item.id)
        })
        setValue('ItemList', itemIdList)
      } catch (error: any) {
        logger.error(`Error while adding items in a list, ${error.stack}`)
      }

      try {
        try {
      if (flow === FLOW.FLOW00A) {
        bppPrvdrs.forEach((provider: any, i: number) => {
          provider.items.forEach(async (item: any, j: number) => {
            const npFeesTag = await validateNpFees(item, provider.categories, provider, flow, errorObj, i, j)
            console.log("npFeesTag",npFeesTag);
            

            if (npFeesTag) {
              // do something with npFeesTag.list
            }
          })
        })
      }
    } catch (error) {
      
    }
      } catch (error) {
        
      }

      logger.info(`Checking store timings in bpp/providers[${i}]`)

      prvdr.locations.forEach((loc: any, iter: any) => {
        try {
          logger.info(`Checking gps precision of store location in /bpp/providers[${i}]/locations[${iter}]`)
          const has = Object.prototype.hasOwnProperty
          if (has.call(loc, 'gps')) {
            if (!checkGpsPrecision(loc.gps)) {
              errorObj.gpsPrecision = `/bpp/providers[${i}]/locations[${iter}]/gps coordinates must be specified with at least 4 decimal places of precision.`
            }
          }
        } catch (error) {
          logger.error(
            `!!Error while checking gps precision of store location in /bpp/providers[${i}]/locations[${iter}]`,
            error,
          )
        }

        if (prvdrLocId.has(loc.id)) {
          const key = `prvdr${i}${loc.id}${iter}`
          errorObj[key] = `duplicate location id: ${loc.id} in /bpp/providers[${i}]/locations[${iter}]`
        } else {
          prvdrLocId.add(loc.id)
        }
        prvdrLocationIds.add(loc?.id)
        logger.info('Checking store days...')
        const days = loc.time.days.split(',')
        days.forEach((day: any) => {
          day = parseInt(day)
          if (isNaN(day) || day < 1 || day > 7) {
            const key = `prvdr${i}locdays${iter}`
            errorObj[key] =
              `store days (bpp/providers[${i}]/locations[${iter}]/time/days) should be in the format ("1,2,3,4,5,6,7") where 1- Monday and 7- Sunday`
          }
        })

        logger.info('Checking fixed or split timings')
        //scenario 1: range =1 freq/times =1
        if (loc.time.range && (loc.time.schedule?.frequency || loc.time.schedule?.times)) {
          const key = `prvdr${i}loctime${iter}`
          errorObj[key] =
            `Either one of fixed (range) or split (frequency and times) timings should be provided in /bpp/providers[${i}]/locations[${iter}]/time`
        }

        // scenario 2: range=0 freq || times =1
        if (!loc.time.range && (!loc.time.schedule.frequency || !loc.time.schedule.times)) {
          const key = `prvdr${i}loctime${iter}`
          errorObj[key] =
            `Either one of fixed timings (range) or split timings (both frequency and times) should be provided in /bpp/providers[${i}]/locations[${iter}]/time`
        }

        //scenario 3: range=1 (start and end not compliant) frequency=0;
        if ('range' in loc.time) {
          logger.info('checking range (fixed timings) start and end')
          const startTime: any = 'start' in loc.time.range ? parseInt(loc.time.range.start) : ''
          const endTime: any = 'end' in loc.time.range ? parseInt(loc.time.range.end) : ''
          if (isNaN(startTime) || isNaN(endTime) || startTime > endTime || endTime > 2359) {
            errorObj.startEndTime = `end time must be greater than start time in fixed timings /locations/time/range (fixed store timings)`
          }
        }
      })

      try {
        // Adding items in a list
        const items = prvdr.items
        items.forEach((item: any) => {
          itemIdList.push(item.id)
        })
        setValue('ItemList', itemIdList)
      } catch (error: any) {
        logger.error(`Error while adding items in a list, ${error.stack}`)
      }

      try {
        logger.info(`Checking categories for provider (${prvdr.id}) in bpp/providers[${i}]`)
        let j = 0
        const categories = onSearchCatalog['bpp/providers'][i]['categories']
        if (!categories || !categories.length) {
          const key = `prvdr${i}categories`
          errorObj[key] = `Support for variants is mandatory, categories must be present in bpp/providers[${i}]`
        }
        const iLen = categories.length
        while (j < iLen) {
          logger.info(`Validating uniqueness for categories id in bpp/providers[${i}].items[${j}]...`)
          const category = categories[j]

          const fulfillments = onSearchCatalog['bpp/providers'][i]['fulfillments']
          const phoneNumber = fulfillments[i].contact.phone

          if (!isValidPhoneNumber(phoneNumber)) {
            const key = `bpp/providers${i}fulfillments${i}`
            errorObj[key] =
              `Please enter a valid phone number consisting of  10 or  11 digits without any spaces or special characters. `
          }

          if (categoriesId.has(category.id)) {
            const key = `prvdr${i}category${j}`
            errorObj[key] = `duplicate category id: ${category.id} in bpp/providers[${i}]`
          } else {
            categoriesId.add(category.id)
          }

          try {
            category.tags.map((tag: { code: any; list: any[] }, index: number) => {
              switch (tag.code) {
                case 'type':
                  const codeList = tag.list.find((item) => item.code === 'type')
                  if (
                    !(
                      codeList.value === 'custom_menu' ||
                      codeList.value === 'custom_group' ||
                      codeList.value === 'variant_group'
                    )
                  ) {
                    const key = `prvdr${i}category${j}tags${index}`
                    errorObj[key] =
                      `list.code == type then value should be one of 'custom_menu','custom_group' and 'variant_group' in bpp/providers[${i}]`
                  }

                  if (codeList.value === 'custom_group') {
                    customGrpId.add(category.id)
                  }

                  break
                case 'timing':
                  for (const item of tag.list) {
                    switch (item.code) {
                      case 'day_from':
                      case 'day_to':
                        const dayValue = parseInt(item.value)
                        if (isNaN(dayValue) || dayValue < 1 || dayValue > 7 || !/^-?\d+(\.\d+)?$/.test(item.value)) {
                          errorObj.custom_menu_timing_tag = `Invalid value for '${item.code}': ${item.value}`
                        }

                        break
                      case 'time_from':
                      case 'time_to':
                        if (!/^([01]\d|2[0-3])[0-5]\d$/.test(item.value)) {
                          errorObj.time_to = `Invalid time format for '${item.code}': ${item.value}`
                        }

                        break
                      default:
                        errorObj.Tagtiming = `Invalid list.code for 'timing': ${item.code}`
                    }
                  }

                  const dayFromItem = tag.list.find((item: any) => item.code === 'day_from')
                  const dayToItem = tag.list.find((item: any) => item.code === 'day_to')
                  const timeFromItem = tag.list.find((item: any) => item.code === 'time_from')
                  const timeToItem = tag.list.find((item: any) => item.code === 'time_to')

                  if (dayFromItem && dayToItem && timeFromItem && timeToItem) {
                    const dayFrom = parseInt(dayFromItem.value, 10)
                    const dayTo = parseInt(dayToItem.value, 10)
                    const timeFrom = parseInt(timeFromItem.value, 10)
                    const timeTo = parseInt(timeToItem.value, 10)

                    if (dayTo < dayFrom) {
                      errorObj.day_from = "'day_to' must be greater than or equal to 'day_from'"
                    }

                    if (timeTo <= timeFrom) {
                      errorObj.time_from = "'time_to' must be greater than 'time_from'"
                    }
                  }

                  break
                case 'display':
                  for (const item of tag.list) {
                    if (item.code !== 'rank' || !/^-?\d+(\.\d+)?$/.test(item.value)) {
                      errorObj.rank = `Invalid value for 'display': ${item.value}`
                    } else {
                      if (categoryRankSet.has(category.id)) {
                        const key = `prvdr${i}category${j}rank`
                        errorObj[key] = `duplicate rank in category id: ${category.id} in bpp/providers[${i}]`
                      } else {
                        categoryRankSet.add(category.id)
                      }
                    }
                  }

                  break
                case 'config':
                  const minItem: any = tag.list.find((item: { code: string }) => item.code === 'min')
                  const maxItem: any = tag.list.find((item: { code: string }) => item.code === 'max')
                  const inputItem: any = tag.list.find((item: { code: string }) => item.code === 'input')
                  const seqItem: any = tag.list.find((item: { code: string }) => item.code === 'seq')

                  if (!minItem || !maxItem) {
                    errorObj[`customization_config_${j}`] =
                      `Both 'min' and 'max' values are required in 'config' at index: ${j}`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(minItem.value)) {
                    errorObj[`customization_config_min_${j}`] =
                      `Invalid value for ${minItem.code}: ${minItem.value} at index: ${j}`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(maxItem.value)) {
                    errorObj[`customization_config_max_${j}`] =
                      `Invalid value for ${maxItem.code}: ${maxItem.value}at index: ${j}`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(seqItem.value)) {
                    errorObj[`config_seq_${j}`] = `Invalid value for ${seqItem.code}: ${seqItem.value} at index: ${j}`
                  }

                  const inputEnum = ['select', 'text']
                  if (!inputEnum.includes(inputItem.value)) {
                    errorObj[`config_input_${j}`] =
                      `Invalid value for 'input': ${inputItem.value}, it should be one of ${inputEnum} at index: ${j}`
                  }

                  break
              }
            })
            logger.info(`Category '${category.descriptor.name}' is valid.`)
          } catch (error: any) {
            logger.error(`Validation error for category '${category.descriptor.name}': ${error.message}`)
          }

          j++
        }
      } catch (error: any) {
        logger.error(`!!Errors while checking categories in bpp/providers[${i}], ${error.stack}`)
      }

      try {
        logger.info(`Checking items for provider (${prvdr.id}) in bpp/providers[${i}]`)
        let j = 0
        const items = onSearchCatalog['bpp/providers'][i]['items']
        const iLen = items.length
        while (j < iLen) {
          logger.info(`Validating uniqueness for item id in bpp/providers[${i}].items[${j}]...`)
          const item = items[j]

          if ('category_id' in item) {
            itemCategory_id.add(item.category_id)
          }

          if ('category_ids' in item) {
            item[`category_ids`].map((category: string, index: number) => {
              const categoryId = category.split(':')[0]
              const seq = category.split(':')[1]

              // Check if seq exists in category_ids
              const seqExists = item[`category_ids`].some((cat: any) => cat.seq === seq)

              if (seqExists) {
                const key = `prvdr${i}item${j}ctgryseq${index}`
                errorObj[key] = `duplicate seq : ${seq} in category_ids in prvdr${i}item${j}`
              } else {
                seqSet.add(seq)
              }

              if (!categoriesId.has(categoryId)) {
                const key = `prvdr${i}item${j}ctgryId${index}`
                errorObj[key] = `item${j} should have category_ids one of the Catalog/categories/id`
              }
            })
          }

          let lower_and_upper_not_present: boolean = true
          let default_selection_not_present: boolean = true
          try {
            logger.info(`Checking selling price and maximum price for item id: ${item.id}`)

            if ('price' in item) {
              const sPrice = parseFloat(item.price.value)
              const maxPrice = parseFloat(item.price.maximum_value)

              const lower = parseFloat(item.price?.tags?.[0].list[0]?.value)
              const upper = parseFloat(item.price?.tags?.[0].list[1]?.value)

              if (lower >= 0 && upper >= 0) {
                lower_and_upper_not_present = false
              }

              const default_selection_value = parseFloat(item.price?.tags?.[1].list[0]?.value)
              const default_selection_max_value = parseFloat(item.price?.tags?.[1].list[1]?.value)

              if (default_selection_value >= 0 && default_selection_max_value >= 0) {
                default_selection_not_present = false
              }

              if (sPrice > maxPrice) {
                const key = `prvdr${i}item${j}Price`
                errorObj[key] =
                  `selling price of item /price/value with id: (${item.id}) can't be greater than the maximum price /price/maximum_value in /bpp/providers[${i}]/items[${j}]/`
              }

              if (upper < lower) {
                const key = `prvdr${i}item${j}price/tags/`
                errorObj[key] =
                  `selling lower range: ${lower} of code: range with id: (${item.id}) can't be greater than the upper range : ${upper} `
              }

              if (default_selection_max_value < default_selection_value) {
                const key = `prvdr${i}item${j}Price/tags`
                errorObj[key] =
                  `value : ${default_selection_value} of code: default_selection with id: (${item.id}) can't be greater than the maximum_value : ${default_selection_max_value} `
              }
            }
          } catch (e: any) {
            logger.error(`Error while checking selling price and maximum price for item id: ${item.id}, ${e.stack}`)
          }

          try {
            logger.info(`Checking fulfillment_id for item id: ${item.id}`)
            if (item.fulfillment_id && !onSearchFFIdsArray[i].has(item.fulfillment_id)) {
              const key = `prvdr${i}item${j}ff`
              errorObj[key] =
                `fulfillment_id in /bpp/providers[${i}]/items[${j}] should map to one of the fulfillments id in bpp/prvdr${i}/fulfillments `
            }
          } catch (e: any) {
            logger.error(`Error while checking fulfillment_id for item id: ${item.id}, ${e.stack}`)
          }

          try {
            logger.info(`Checking location_id for item id: ${item.id}`)

            if (item.location_id && !prvdrLocId.has(item.location_id)) {
              const key = `prvdr${i}item${j}loc`
              errorObj[key] =
                `location_id in /bpp/providers[${i}]/items[${j}] should be one of the locations id in /bpp/providers[${i}]/locations`
            }
          } catch (e: any) {
            logger.error(`Error while checking location_id for item id: ${item.id}, ${e.stack}`)
          }

          try {
            logger.info(`Checking consumer care details for item id: ${item.id}`)
            if ('@ondc/org/contact_details_consumer_care' in item) {
              let consCare = item['@ondc/org/contact_details_consumer_care']
              consCare = consCare.split(',')
              if (consCare.length < 3) {
                const key = `prvdr${i}consCare`
                errorObj[key] =
                  `@ondc/org/contact_details_consumer_care should be in the format "name,email,contactno" in /bpp/providers[${i}]/items`
              } else {
                const checkEmail: boolean = emailRegex(consCare[1].trim())
                if (isNaN(consCare[2].trim()) || !checkEmail) {
                  const key = `prvdr${i}consCare`
                  errorObj[key] =
                    `@ondc/org/contact_details_consumer_care should be in the format "name,email,contactno" in /bpp/providers[${i}]/items`
                }
              }
            }
          } catch (e: any) {
            logger.error(`Error while checking consumer care details for item id: ${item.id}, ${e.stack}`)
          }

          try {
            item.tags.map((tag: { code: any; list: any[] }, index: number) => {
              switch (tag.code) {
                case 'type':
                  if (
                    tag.list &&
                    Array.isArray(tag.list) &&
                    tag.list.some(
                      (listItem: { code: string; value: string }) =>
                        listItem.code === 'type' && listItem.value === 'item',
                    )
                  ) {
                    if (!item.time) {
                      const key = `prvdr${i}item${j}time`
                      errorObj[key] = `item_id: ${item.id} should contain time object in bpp/providers[${i}]`
                    }

                    if (!item.category_ids) {
                      const key = `prvdr${i}item${j}ctgry_ids`
                      errorObj[key] = `item_id: ${item.id} should contain category_ids in bpp/providers[${i}]`
                    }
                  }
                  break

                case 'custom_group':
                  tag.list.map((it: { code: string; value: string }, index: number) => {
                    if (!customGrpId.has(it.value)) {
                      const key = `prvdr${i}item${j}tag${index}cstmgrp_id`
                      errorObj[key] =
                        `item_id: ${item.id} should have custom_group_id one of the ids passed in categories bpp/providers[${i}]`
                    }
                  })

                  break

                case 'config':
                  const idList: any = tag.list.find((item: { code: string }) => item.code === 'id')
                  const minList: any = tag.list.find((item: { code: string }) => item.code === 'min')
                  const maxList: any = tag.list.find((item: { code: string }) => item.code === 'max')
                  const seqList: any = tag.list.find((item: { code: string }) => item.code === 'seq')

                  if (!categoriesId.has(idList.value)) {
                    const key = `prvdr${i}item${j}tags${index}config_list`
                    errorObj[key] =
                      `value in catalog/items${j}/tags${index}/config/list/ should be one of the catalog/category/ids`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(minList.value)) {
                    const key = `prvdr${i}item${j}tags${index}config_min`
                    errorObj[key] = `Invalid value for ${minList.code}: ${minList.value}`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(maxList.value)) {
                    const key = `prvdr${i}item${j}tags${index}config_max`
                    errorObj[key] = `Invalid value for ${maxList.code}: ${maxList.value}`
                  }

                  if (!/^-?\d+(\.\d+)?$/.test(seqList.value)) {
                    const key = `prvdr${i}item${j}tags${index}config_seq`
                    errorObj[key] = `Invalid value for ${seqList.code}: ${seqList.value}`
                  }

                  break

                case 'timing':
                  for (const item of tag.list) {
                    switch (item.code) {
                      case 'day_from':
                      case 'day_to':
                        const dayValue = parseInt(item.value)
                        if (isNaN(dayValue) || dayValue < 1 || dayValue > 5 || !/^-?\d+(\.\d+)?$/.test(item.value)) {
                          const key = `prvdr${i}item${j}tags${index}timing_day`
                          errorObj[key] = `Invalid value for '${item.code}': ${item.value}`
                        }

                        break
                      case 'time_from':
                      case 'time_to':
                        if (!/^([01]\d|2[0-3])[0-5]\d$/.test(item.value)) {
                          const key = `prvdr${i}item${j}tags${index}timing_time`
                          errorObj[key] = `Invalid time format for '${item.code}': ${item.value}`
                        }

                        break
                      default:
                        errorObj.Tagtiming = `Invalid list.code for 'timing': ${item.code}`
                    }
                  }

                  const dayFromItem = tag.list.find((item: any) => item.code === 'day_from')
                  const dayToItem = tag.list.find((item: any) => item.code === 'day_to')
                  const timeFromItem = tag.list.find((item: any) => item.code === 'time_from')
                  const timeToItem = tag.list.find((item: any) => item.code === 'time_to')

                  if (dayFromItem && dayToItem && timeFromItem && timeToItem) {
                    const dayFrom = parseInt(dayFromItem.value, 10)
                    const dayTo = parseInt(dayToItem.value, 10)
                    const timeFrom = parseInt(timeFromItem.value, 10)
                    const timeTo = parseInt(timeToItem.value, 10)

                    if (dayTo < dayFrom) {
                      const key = `prvdr${i}item${j}tags${index}timing_dayfrom`
                      errorObj[key] = "'day_to' must be greater than or equal to 'day_from'"
                    }

                    if (timeTo <= timeFrom) {
                      const key = `prvdr${i}item${j}tags${index}timing_timefrom`
                      errorObj[key] = "'time_to' must be greater than 'time_from'"
                    }
                  }

                  break

                case 'veg_nonveg':
                  const allowedCodes = ['veg', 'non_veg', 'egg']

                  for (const it of tag.list) {
                    if (it.code && !allowedCodes.includes(it.code)) {
                      const key = `prvdr${i}item${j}tag${index}veg_nonveg`
                      errorObj[key] =
                        `item_id: ${item.id} should have veg_nonveg one of the 'veg', 'non_veg'or 'egg' in bpp/providers[${i}]`
                    }
                  }

                  break
              }
            })
          } catch (e: any) {
            logger.error(`Error while checking tags for item id: ${item.id}, ${e.stack}`)
          }
          //Validating Offers
          try {
            logger.info(`Checking offers.tags under bpp/providers`)

            // Iterate through bpp/providers
            for (let i in onSearchCatalog['bpp/providers']) {
              const offers = onSearchCatalog['bpp/providers'][i]?.offers ?? null
              if (!offers) {
                offers.forEach((offer: any, offerIndex: number) => {
                  const tags = offer.tags

                  // Ensure tags exist
                  if (!tags || !Array.isArray(tags)) {
                    const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags`
                    errorObj[key] =
                      `Tags must be provided for offers[${offerIndex}] with descriptor code '${offer.descriptor?.code}'`
                    logger.error(
                      `Tags must be provided for offers[${offerIndex}] with descriptor code '${offer.descriptor?.code}'`,
                    )
                    return
                  }
                  const metaTagsError = validateMetaTags(tags)
                  if (metaTagsError) {
                    let i = 0
                    const len = metaTagsError.length
                    while (i < len) {
                      const key = `fulfilmntRngErr${i}`
                      errorObj[key] = `${metaTagsError[i]}`
                      i++
                    }
                  }

                  // Validate based on offer type
                  switch (offer.descriptor?.code) {
                    case 'discount':
                      // Validate 'qualifier'
                      const qualifierDiscount = tags.find((tag: any) => tag.code === 'qualifier')
                      if (
                        !qualifierDiscount ||
                        !qualifierDiscount.list.some((item: any) => item.code === 'min_value')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
                        errorObj[key] =
                          `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
                      }

                      // Validate 'benefit'
                      const benefitDiscount = tags.find((tag: any) => tag.code === 'benefit')
                      if (
                        !benefitDiscount ||
                        !benefitDiscount.list.some((item: any) => item.code === 'value') ||
                        !benefitDiscount.list.some((item: any) => item.code === 'value_type')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
                        errorObj[key] =
                          `'benefit' tag must include both 'value' and 'value_type' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(
                          `'benefit' tag must include both 'value' and 'value_type' for offers[${offerIndex}]`,
                        )
                      }
                      break

                    case 'buyXgetY':
                      // Validate 'qualifier'
                      const qualifierBuyXgetY = tags.find((tag: any) => tag.code === 'qualifier')
                      if (
                        !qualifierBuyXgetY ||
                        !qualifierBuyXgetY.list.some((item: any) => item.code === 'min_value') ||
                        !qualifierBuyXgetY.list.some((item: any) => item.code === 'item_count')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
                        errorObj[key] =
                          `'qualifier' tag must include 'min_value' and 'item_count' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(
                          `'qualifier' tag must include 'min_value' and 'item_count' for offers[${offerIndex}]`,
                        )
                      }

                      // Validate 'benefit'
                      const benefitBuyXgetY = tags.find((tag: any) => tag.code === 'benefit')
                      if (!benefitBuyXgetY || !benefitBuyXgetY.list.some((item: any) => item.code === 'item_count')) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
                        errorObj[key] =
                          `'benefit' tag must include 'item_count' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(`'benefit' tag must include 'item_count' for offers[${offerIndex}]`)
                      }
                      break

                    case 'freebie':
                      // Validate 'qualifier'
                      const qualifierFreebie = tags.find((tag: any) => tag.code === 'qualifier')
                      if (!qualifierFreebie || !qualifierFreebie.list.some((item: any) => item.code === 'min_value')) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
                        errorObj[key] =
                          `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
                      }

                      // Validate 'benefit'
                      const benefitFreebie = tags.find((tag: any) => tag.code === 'benefit')
                      if (
                        !benefitFreebie ||
                        !benefitFreebie.list.some((item: any) => item.code === 'item_count') ||
                        !benefitFreebie.list.some((item: any) => item.code === 'item_id') ||
                        !benefitFreebie.list.some((item: any) => item.code === 'item_value')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
                        errorObj[key] =
                          `'benefit' tag must include 'item_count', 'item_id', and 'item_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(
                          `'benefit' tag must include 'item_count', 'item_id', and 'item_value' for offers[${offerIndex}]`,
                        )
                      }
                      break

                    case 'slab':
                      // Validate 'qualifier'
                      const qualifierSlab = tags.find((tag: any) => tag.code === 'qualifier')
                      if (!qualifierSlab || !qualifierSlab.list.some((item: any) => item.code === 'min_value')) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
                        errorObj[key] =
                          `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
                      }

                      // Validate 'benefit'
                      const benefitSlab = tags.find((tag: any) => tag.code === 'benefit')
                      if (
                        !benefitSlab ||
                        !benefitSlab.list.some((item: any) => item.code === 'value') ||
                        !benefitSlab.list.some((item: any) => item.code === 'value_type') ||
                        !benefitSlab.list.some((item: any) => item.code === 'value_cap')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
                        errorObj[key] =
                          `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(
                          `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}]`,
                        )
                      }
                      break

                    case 'combo':
                      // Validate 'qualifier'
                      const qualifierCombo = tags.find((tag: any) => tag.code === 'qualifier')
                      if (
                        !qualifierCombo ||
                        !qualifierCombo.list.some((item: any) => item.code === 'min_value') ||
                        !qualifierCombo.list.some((item: any) => item.code === 'item_id')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
                        errorObj[key] =
                          `'qualifier' tag must include 'min_value' and 'item_id' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(`'qualifier' tag must include 'min_value' and 'item_id' for offers[${offerIndex}]`)
                      }

                      // Validate 'benefit'
                      const benefitCombo = tags.find((tag: any) => tag.code === 'benefit')
                      if (
                        !benefitCombo ||
                        !benefitCombo.list.some((item: any) => item.code === 'value') ||
                        !benefitCombo.list.some((item: any) => item.code === 'value_type') ||
                        !benefitCombo.list.some((item: any) => item.code === 'value_cap')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
                        errorObj[key] =
                          `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(
                          `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}]`,
                        )
                      }
                      break

                    case 'delivery':
                      // Validate 'qualifier'
                      const qualifierDelivery = tags.find((tag: any) => tag.code === 'qualifier')
                      if (
                        !qualifierDelivery ||
                        !qualifierDelivery.list.some((item: any) => item.code === 'min_value')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
                        errorObj[key] =
                          `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
                      }

                      // Validate 'benefit'
                      const benefitDelivery = tags.find((tag: any) => tag.code === 'benefit')
                      if (
                        !benefitDelivery ||
                        !benefitDelivery.list.some((item: any) => item.code === 'value') ||
                        !benefitDelivery.list.some((item: any) => item.code === 'value_type') ||
                        !benefitDelivery.list.some((item: any) => item.code === 'value_cap')
                      ) {
                        const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
                        errorObj[key] =
                          `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
                        logger.error(
                          `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}]`,
                        )
                      }
                      break

                    // case 'exchange':
                    case 'financing':
                      // Validate 'qualifier'
                      //   const qualifierExchangeFinancing = tags.find((tag: any) => tag.code === 'qualifier');
                      //   if (!qualifierExchangeFinancing || !qualifierExchangeFinancing.list.some((item: any) => item.code === 'min_value')) {
                      //     const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`;
                      //     errorObj[key] = `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`;
                      //     logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`);
                      //   }

                      // // Validate that benefits should not exist or should be empty
                      // const benefitExchangeFinancing = tags.find((tag: any) => tag.code === 'benefit');
                      // if (benefitExchangeFinancing && benefitExchangeFinancing.list.length > 0) {
                      //   const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`;
                      //   errorObj[key] = `'benefit' tag must not include any values for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`;
                      //   logger.error(`'benefit' tag must not include any values for offers[${offerIndex}]`);
                      // }
                      break

                    // No validation for benefits as it is not required
                    // break;

                    default:
                      logger.info(`No specific validation required for offer type: ${offer.descriptor?.code}`)
                  }
                })
              }
            }
          } catch (error: any) {
            logger.error(`Error while checking offers.tags under bpp/providers: ${error.stack}`)
          }

          // false error coming from here
          try {
            logger.info(`Validating item tags`)
            const itemTypeTag = item.tags.find((tag: { code: string }) => tag.code === 'type')
            const customGroupTag = item.tags.find((tag: { code: string }) => tag.code === 'custom_group')
            if (itemTypeTag && itemTypeTag.list.length > 0 && itemTypeTag.list[0].value === 'item' && !customGroupTag) {
              errorObj[`items[${item.id}]`] =
                `/message/catalog/bpp/providers/items/tags/'type' is optional for non-customizable (standalone) SKUs`
            } else if (
              itemTypeTag &&
              itemTypeTag.list.length > 0 &&
              itemTypeTag.list[0].value === 'item' &&
              customGroupTag
            ) {
              if (default_selection_not_present) {
                errorObj[`items[${item.id}]/price/tags/default_selection`] =
                  `/message/catalog/bpp/providers/items must have default_selection price for customizable items`
              }
              if (lower_and_upper_not_present) {
                errorObj[`items[${item.id}]/price/tags/lower_and_upper_range`] =
                  `/message/catalog/bpp/providers/items must have lower/upper range for customizable items`
              }
            }
          } catch (error: any) {
            logger.error(`Error while validating item, ${error.stack}`)
          }

          try {
            logger.info(`Validating default customizations`)
            const itemTypeTag = item.tags.find(
              (tag: any) =>
                tag.code === 'type' &&
                tag.list.some((item: any) => item.code === 'type' && item.value === 'customization'),
            )
            if (itemTypeTag) {
              const parentTag = item.tags.find((tag: any) => tag.code === 'parent')
              if (parentTag) {
                const categoryId = parentTag.list.find((item: any) => item.code === 'id')?.value
                if (categoryId) {
                  const category = categories.find((category: any) => category.id === categoryId)
                  if (category) {
                    const configTag = category.tags.find((tag: any) => tag.code === 'config')
                    if (configTag) {
                      const minSelection = configTag.list.find((item: any) => item.code === 'min')?.value
                      if (minSelection === '0') {
                        const defaultTag = parentTag.list.find((item: any) => item.code === 'default')
                        if (defaultTag && defaultTag.value === 'yes') {
                          errorObj[`items[${item.id}]category[${categoryId}]`] =
                            `Default customization should not be set true for a custom_group where min selection is 0`
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (error: any) {
            logger.error(`Error while validating default customizations, ${error.stack}`)
          }

          j++
        }
      } catch (error: any) {
        logger.error(`!!Errors while checking items in bpp/providers[${i}], ${error.stack}`)
      }

      try {
        const providers = data.message.catalog['bpp/providers']
        const address = providers[0].locations[0].address

        if (address) {
          const area_code = Number.parseInt(address.area_code)
          const std = context.city.split(':')[1]

          logger.info(`Comparing area_code and STD Code for /${constants.ON_SEARCH}`)
          const areaWithSTD = compareSTDwithArea(area_code, std)
          if (!areaWithSTD) {
            logger.error(`STD code does not match with correct area_code on /${constants.ON_SEARCH}`)
            errorObj.invldAreaCode = `STD code does not match with correct area_code on /${constants.ON_SEARCH}`
          }
        }
      } catch (error: any) {
        logger.error(
          `Error while matching area_code and std code for /${constants.SEARCH} and /${constants.ON_SEARCH} api, ${error.stack}`,
        )
      }

      // Compairing valid timestamp in context.timestamp and bpp/providers/items/time/timestamp
      try {
        logger.info(`Compairing valid timestamp in context.timestamp and bpp/providers/items/time/timestamp`)
        const timestamp = context.timestamp
        for (let i in onSearchCatalog['bpp/providers']) {
          const items = onSearchCatalog['bpp/providers'][i].items
          items.forEach((item: any, index: number) => {
            if (item?.time) {
              const itemTimeStamp = item.time.timestamp
              const op = areTimestampsLessThanOrEqualTo(itemTimeStamp, timestamp)
              if (!op) {
                const key = `bpp/providers/items/time/timestamp[${index}]`
                errorObj[key] = `Timestamp for item[${index}] can't be greater than context.timestamp`
                logger.error(`Timestamp for item[${index}] can't be greater than context.timestamp`)
              }
            }
          })
        }
      } catch (error: any) {
        logger.error(
          `!!Errors while checking timestamp in context.timestamp and bpp/providers/items/time/timestamp, ${error.stack}`,
        )
      }

      try {
        logger.info(`Checking for tags array in message/catalog/bpp/providers[0]/categories[0]/tags`)
        const categories = message.catalog['bpp/providers'][i].categories
        categories.forEach((item: any) => {
          const tags = item.tags
          if (tags.length < 1) {
            const key = `message/catalog/bpp/providers/categories`
            errorObj[key] = `/message/catalog/bpp/providers[${i}]/categories cannot have tags as an empty array`
          }
        })
      } catch (error: any) {
        logger.error(`Error while checking tags array in message/catalog/bpp/providers[${i}]/categories`)
      }

      try {
        let customMenus = []
        customMenus = categories.filter((category: any) =>
          category.tags.some(
            (tag: any) => tag.code === 'type' && tag.list.some((type: any) => type.value === 'custom_menu'),
          ),
        )

        if (customMenus.length > 0) {
          customMenu = true

          const ranks = customMenus.map((cstmMenu: any) =>
            parseInt(
              cstmMenu.tags
                .find((tag: any) => tag.code === 'display')
                .list.find((display: any) => display.code === 'rank').value,
            ),
          )

          // Check for duplicates and missing ranks
          const hasDuplicates = ranks.length !== new Set(ranks).size
          const missingRanks = [...Array(Math.max(...ranks)).keys()]
            .map((i) => i + 1)
            .filter((rank) => !ranks.includes(rank))

          if (hasDuplicates) {
            const key = `message/catalog/bpp/providers${i}/categories/ranks`
            errorObj[key] = `Duplicate ranks found, ${ranks} in providers${i}/categories`
            logger.error(`Duplicate ranks found, ${ranks} in providers${i}/categories`)
          } else if (missingRanks.length > 0) {
            const key = `message/catalog/bpp/providers${i}/categories/ranks`
            errorObj[key] = `Missing ranks:, ${missingRanks} in providers${i}/categories`
            logger.error(`Missing ranks:, ${missingRanks} in providers${i}/categories`)
          } else {
            // Sort customMenus by rank
            const sortedCustomMenus = customMenus.sort((a: any, b: any) => {
              const rankA = parseInt(
                a.tags.find((tag: any) => tag.code === 'display').list.find((display: any) => display.code === 'rank')
                  .value,
              )
              const rankB = parseInt(
                b.tags.find((tag: any) => tag.code === 'display').list.find((display: any) => display.code === 'rank')
                  .value,
              )
              return rankA - rankB
            })

            // Extract IDs
            customMenuIds = sortedCustomMenus.map((item: any) => item.id)
          }
        }
      } catch (error: any) {
        logger.error(`!!Errors while checking rank in bpp/providers[${i}].category.tags, ${error.stack}`)
      }
      if (customMenu) {
        try {
          const categoryMap: Record<string, number[]> = {}
          onSearchCatalog['bpp/providers'][i]['items'].forEach((item: any) => {
            if (item?.category_ids) {
              item?.category_ids?.forEach((category_id: any) => {
                const [category, sequence] = category_id.split(':').map(Number)
                if (!categoryMap[category]) {
                  categoryMap[category] = []
                }
                categoryMap[category].push(sequence)
              })

              // Sort the sequences for each category
              Object.keys(categoryMap).forEach((category) => {
                categoryMap[category].sort((a, b) => a - b)
              })
            }
          })
          let countSeq = 0

          customMenuIds.map((category_id: any) => {
            const categoryArray = categoryMap[`${category_id}`]
            if (!categoryArray) {
              const key = `message/catalog/bpp/providers${i}/categories/items`
              errorObj[key] = `No items are mapped with the given category_id ${category_id} in providers${i}/items`
              logger.error(`No items are mapped with the given category_id ${category_id} in providers${i}/items`)
            } else {
              let i = 0
              while (i < categoryArray.length) {
                countSeq++
                const exist = categoryArray.includes(countSeq)
                if (!exist) {
                  const key = `providers${i}/categories/items/${countSeq}`
                  errorObj[key] =
                    `The given sequence ${countSeq} doesn't exist with with the given category_id ${category_id} in providers${i}/items according to the rank`
                  logger.error(
                    `The given sequence ${countSeq} doesn't exist with with the given category_id ${category_id} in providers${i}/items according to the rank`,
                  )
                }
                i++
              }
            }
          })
        } catch (error: any) {
          logger.error(`!!Errors while category_ids in the items, ${error.stack}`)
        }
      }

      // Checking image array for bpp/providers/[]/categories/[]/descriptor/images[]
      try {
        logger.info(`Checking image array for bpp/provider/categories/descriptor/images[]`)
        for (let i in onSearchCatalog['bpp/providers']) {
          const categories = onSearchCatalog['bpp/providers'][i].categories
          categories.forEach((item: any, index: number) => {
            if (item.descriptor.images && item.descriptor.images.length < 1) {
              const key = `bpp/providers[${i}]/categories[${index}]/descriptor`
              errorObj[key] = `Images should not be provided as empty array for categories[${index}]/descriptor`
              logger.error(`Images should not be provided as empty array for categories[${index}]/descriptor`)
            }
          })
        }
      } catch (error: any) {
        logger.error(
          `!!Errors while checking image array for bpp/providers/[]/categories/[]/descriptor/images[], ${error.stack}`,
        )
      }

      // Checking for same parent_item_id
      // try {
      //   logger.info(`Checking for duplicate varient in bpp/providers/items for on_search`)
      //   for (let i in onSearchCatalog['bpp/providers']) {
      //     const items = onSearchCatalog['bpp/providers'][i].items
      //     const map = checkDuplicateParentIdItems(items)
      //     for (let key in map) {
      //       if (map[key].length > 1) {
      //         const measures = map[key].map((item: any) => {
      //           const unit = item.quantity.unitized.measure.unit
      //           const value = parseInt(item.quantity.unitized.measure.value)
      //           return { unit, value }
      //         })
      //         checkForDuplicates(measures, errorObj)
      //       }
      //     }
      //   }
      // } catch (error: any) {
      //   logger.error(
      //     `!!Errors while checking parent_item_id in bpp/providers/[]/items/[]/parent_item_id/, ${error.stack}`,
      //   )
      // }

      // servicability Construct
      try {
        logger.info(`Checking serviceability construct for bpp/providers[${i}]`)

        const tags = onSearchCatalog['bpp/providers'][i]['tags']
        if (!tags || !tags.length) {
          const key = `prvdr${i}tags`
          errorObj[key] = `tags must be present in bpp/providers[${i}]`
        }
        if (tags) {
          const circleRequired = checkServiceabilityType(tags)
          if (circleRequired) {
            const errors = validateLocations(message.catalog['bpp/providers'][i].locations, tags)
            errorObj = { ...errorObj, ...errors }
          }
        }

        //checking for each serviceability construct and matching serviceability constructs with the previous ones
        const serviceabilitySet = new Set()
        const timingSet = new Set()
        tags.forEach((sc: any, t: any) => {
          if (sc.code === 'serviceability') {
            if (serviceabilitySet.has(JSON.stringify(sc))) {
              const key = `prvdr${i}tags${t}`
              errorObj[key] =
                `serviceability construct /bpp/providers[${i}]/tags[${t}] should not be same with the previous serviceability constructs`
            }

            serviceabilitySet.add(JSON.stringify(sc))
            if ('list' in sc) {
              if (sc.list.length < 5) {
                const key = `prvdr${i}tags${t}`
                errorObj[key] =
                  `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract`
              }

              //checking location
              const loc = sc.list.find((elem: any) => elem.code === 'location') || ''
              if (!loc) {
                const key = `prvdr${i}tags${t}loc`
                errorObj[key] =
                  `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (location is missing)`
              } else {
                if ('value' in loc) {
                  if (!prvdrLocId.has(loc.value)) {
                    const key = `prvdr${i}tags${t}loc`
                    errorObj[key] =
                      `location in serviceability construct should be one of the location ids bpp/providers[${i}]/locations`
                  }
                } else {
                  const key = `prvdr${i}tags${t}loc`
                  errorObj[key] =
                    `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (location is missing)`
                }
              }

              //checking category
              const ctgry = sc.list.find((elem: any) => elem.code === 'category') || ''
              if (!ctgry) {
                const key = `prvdr${i}tags${t}ctgry`
                errorObj[key] =
                  `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (category is missing)`
              } else {
                if ('value' in ctgry) {
                  if (!itemCategory_id.has(ctgry.value)) {
                    const key = `prvdr${i}tags${t}ctgry`
                    errorObj[key] =
                      `category in serviceability construct should be one of the category ids bpp/providers[${i}]/items/category_id`
                  }
                } else {
                  const key = `prvdr${i}tags${t}ctgry`
                  errorObj[key] =
                    `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (category is missing)`
                }
              }

              //checking type (hyperlocal, intercity or PAN India)
              const type = sc.list.find((elem: any) => elem.code === 'type') || ''
              if (!type) {
                const key = `prvdr${i}tags${t}type`
                errorObj[key] =
                  `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (type is missing)`
              } else {
                if ('value' in type) {
                  switch (type.value) {
                    case '10':
                      {
                        //For hyperlocal

                        //checking value
                        const val = sc.list.find((elem: any) => elem.code === 'val') || ''
                        if ('value' in val) {
                          if (isNaN(val.value)) {
                            const key = `prvdr${i}tags${t}valvalue`
                            errorObj[key] =
                              `value should be a number (code:"val") for type 10 (hyperlocal) in /bpp/providers[${i}]/tags[${t}]`
                          }
                        } else {
                          const key = `prvdr${i}tags${t}val`
                          errorObj[key] =
                            `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "val")`
                        }

                        //checking unit
                        const unit = sc.list.find((elem: any) => elem.code === 'unit') || ''
                        if ('value' in unit) {
                          if (unit.value != 'km') {
                            const key = `prvdr${i}tags${t}unitvalue`
                            errorObj[key] =
                              `value should be "km" (code:"unit") for type 10 (hyperlocal) in /bpp/providers[${i}]/tags[${t}]`
                          }
                        } else {
                          const key = `prvdr${i}tags${t}unit`
                          errorObj[key] =
                            `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "unit")`
                        }
                      }

                      break
                    case '11':
                      {
                        //intercity

                        //checking value
                        const val = sc.list.find((elem: any) => elem.code === 'val') || ''
                        if ('value' in val) {
                          const pincodes = val.value.split(/,|-/)
                          pincodes.forEach((pincode: any) => {
                            if (isNaN(pincode) || pincode.length != 6) {
                              const key = `prvdr${i}tags${t}valvalue`
                              errorObj[key] =
                                `value should be a valid range of pincodes (code:"val") for type 11 (intercity) in /bpp/providers[${i}]/tags[${t}]`
                            }
                          })
                        } else {
                          const key = `prvdr${i}tags${t}val`
                          errorObj[key] =
                            `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "val")`
                        }

                        //checking unit
                        const unit = sc.list.find((elem: any) => elem.code === 'unit') || ''
                        if ('value' in unit) {
                          if (unit.value != 'pincode') {
                            const key = `prvdr${i}tags${t}unitvalue`
                            errorObj[key] =
                              `value should be "pincode" (code:"unit") for type 11 (intercity) in /bpp/providers[${i}]/tags[${t}]`
                          }
                        } else {
                          const key = `prvdr${i}tags${t}unit`
                          errorObj[key] =
                            `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "unit")`
                        }
                      }

                      break
                    case '12':
                      {
                        //PAN India

                        //checking value
                        const val = sc.list.find((elem: any) => elem.code === 'val') || ''
                        if ('value' in val) {
                          if (val.value != 'IND') {
                            const key = `prvdr${i}tags${t}valvalue`
                            errorObj[key] =
                              `value should be "IND" (code:"val") for type 12 (PAN India) in /bpp/providers[${i}]tags[${t}]`
                          }
                        } else {
                          const key = `prvdr${i}tags${t}val`
                          errorObj[key] =
                            `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "val")`
                        }

                        //checking unit
                        const unit = sc.list.find((elem: any) => elem.code === 'unit') || ''
                        if ('value' in unit) {
                          if (unit.value != 'country') {
                            const key = `prvdr${i}tags${t}unitvalue`
                            errorObj[key] =
                              `value should be "country" (code:"unit") for type 12 (PAN India) in /bpp/providers[${i}]tags[${t}]`
                          }
                        } else {
                          const key = `prvdr${i}tags${t}unit`
                          errorObj[key] =
                            `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (value is missing for code "unit")`
                        }
                      }
                      break
                    case '13': {
                      // Polygon-based serviceability

                      // Validate 'val' (GeoJSON)
                      const val = sc.list.find((elem: any) => elem.code === 'val') || ''
                      if ('value' in val) {
                        let geojson
                        try {
                          geojson = JSON.parse(val.value)

                          const isFeatureCollection =
                            geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)
                          if (!isFeatureCollection) {
                            throw new Error('Invalid GeoJSON type or missing features array')
                          }

                          for (const feature of geojson.features) {
                            const geom = feature.geometry
                            if (!geom || !geom.type || !Array.isArray(geom.coordinates)) {
                              throw new Error('Invalid feature geometry')
                            }

                            const checkCoordinates = (coords: any) => {
                              for (const polygon of coords) {
                                if (!Array.isArray(polygon)) throw new Error('Invalid coordinate set')
                                const [first, last] = [polygon[0], polygon[polygon.length - 1]]

                                // Check closure
                                if (JSON.stringify(first) !== JSON.stringify(last)) {
                                  throw new Error('Polygon is not closed')
                                }

                                // Check precision
                                for (const [lng, lat] of polygon) {
                                  if (typeof lng !== 'number' || typeof lat !== 'number') {
                                    throw new Error('Coordinates must be numbers')
                                  }

                                  const getDecimalPlaces = (num: number) => {
                                    const parts = num.toString().split('.')
                                    return parts[1]?.length || 0
                                  }

                                  if (getDecimalPlaces(lng) < 4 || getDecimalPlaces(lat) < 4) {
                                    throw new Error('Coordinates must have at least 4 decimal places')
                                  }
                                }
                              }
                            }

                            if (geom.type === 'Polygon') {
                              checkCoordinates(geom.coordinates)
                            } else if (geom.type === 'MultiPolygon') {
                              for (const coords of geom.coordinates) {
                                checkCoordinates(coords)
                              }
                            } else {
                              throw new Error('Unsupported geometry type')
                            }
                          }
                        } catch (e) {
                          const key = `prvdr${i}tags${t}valvalue`
                          if (e instanceof Error) {
                            errorObj[key] =
                              `value should be a valid GeoJSON (code:"val") for type 13 (polygon) in /bpp/providers[${i}]/tags[${t}]. Error: ${e.message}`
                          } else {
                            errorObj[key] =
                              `value should be a valid GeoJSON (code:"val") for type 13 (polygon) in /bpp/providers[${i}]/tags[${t}]. Unknown error occurred.`
                          }
                        }
                      } else {
                        const key = `prvdr${i}tags${t}val`
                        errorObj[key] =
                          `value is missing for code "val" in type 13 (polygon) at /bpp/providers[${i}]/tags[${t}]`
                      }

                      // Validate 'unit'
                      const unit = sc.list.find((elem: any) => elem.code === 'unit') || ''
                      if ('value' in unit) {
                        if (unit.value !== 'geojson') {
                          const key = `prvdr${i}tags${t}unitvalue`
                          errorObj[key] =
                            `value should be "geojson" (code:"unit") for type 13 (polygon) in /bpp/providers[${i}]/tags[${t}]`
                        }
                      } else {
                        const key = `prvdr${i}tags${t}unit`
                        errorObj[key] =
                          `value is missing for code "unit" in type 13 (polygon) at /bpp/providers[${i}]/tags[${t}]`
                      }

                      break
                    }
                    default: {
                      const key = `prvdr${i}tags${t}type`
                      errorObj[key] =
                        `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (invalid type "${type.value}")`
                    }
                  }
                } else {
                  const key = `prvdr${i}tags${t}type`
                  errorObj[key] =
                    `serviceability construct /bpp/providers[${i}]/tags[${t}] should be defined as per the API contract (type is missing)`
                }
              }
            }
          }
          if (sc.code === 'timing') {
            if (timingSet.has(JSON.stringify(sc))) {
              const key = `prvdr${i}tags${t}`
              errorObj[key] =
                `timing construct /bpp/providers[${i}]/tags[${t}] should not be same with the previous timing constructs`
            }

            timingSet.add(JSON.stringify(sc))
            const fulfillments = prvdr['fulfillments']
            const fulfillmentTypes = fulfillments.map((fulfillment: any) => fulfillment.type)

            let isOrderPresent = false
            const typeCode = sc?.list.find((item: any) => item.code === 'type')
            if (typeCode) {
              const timingType = typeCode.value
              if (
                timingType === 'Order' ||
                timingType === 'Delivery' ||
                timingType === 'Self-Pickup' ||
                timingType === 'All'
              ) {
                isOrderPresent = true
              } else if (!fulfillmentTypes.includes(timingType)) {
                errorObj[`provider[${i}].timing`] =
                  `The type '${timingType}' in timing tags should match with types in fulfillments array, along with 'Order'`
              }
            }

            if (!isOrderPresent) {
              errorObj[`provider[${i}].tags.timing`] = `'Order' type must be present in timing tags`
            }
          }
        })
        if (isEmpty(serviceabilitySet)) {
          const key = `prvdr${i}tags/serviceability`
          errorObj[key] = `serviceability construct is mandatory in /bpp/providers[${i}]/tags`
        } else if (serviceabilitySet.size != itemCategory_id.size) {
          const key = `prvdr${i}/serviceability`
          errorObj[key] =
            `The number of unique category_id should be equal to count of serviceability in /bpp/providers[${i}]`
        }
        if (isEmpty(timingSet)) {
          const key = `prvdr${i}tags/timing`
          errorObj[key] = `timing construct is mandatory in /bpp/providers[${i}]/tags`
        } else {
          const timingsPayloadArr = new Array(...timingSet).map((item: any) => JSON.parse(item))
          const timingsAll = _.chain(timingsPayloadArr)
            .filter((payload) => _.some(payload.list, { code: 'type', value: 'All' }))
            .value()

          // Getting timings object for 'Delivery', 'Self-Pickup' and 'Order'
          const timingsOther = _.chain(timingsPayloadArr)
            .filter(
              (payload) =>
                _.some(payload.list, { code: 'type', value: 'Order' }) ||
                _.some(payload.list, { code: 'type', value: 'Delivery' }) ||
                _.some(payload.list, { code: 'type', value: 'Self-Pickup' }),
            )
            .value()

          if (timingsAll.length > 0 && timingsOther.length > 0) {
            errorObj[`prvdr${i}tags/timing`] =
              `If the timings of type 'All' is provided then timings construct for 'Order'/'Delivery'/'Self-Pickup' is not required`
          }

          const arrTimingTypes = new Set()

          function checkTimingTag(tag: any) {
            const typeObject = tag.list.find((item: { code: string }) => item.code === 'type')
            const typeValue = typeObject ? typeObject.value : null
            arrTimingTypes.add(typeValue)
            for (const item of tag.list) {
              switch (item.code) {
                case 'day_from':
                case 'day_to':
                  const dayValue = parseInt(item.value)
                  if (isNaN(dayValue) || dayValue < 1 || dayValue > 7 || !/^-?\d+(\.\d+)?$/.test(item.value)) {
                    errorObj[`prvdr${i}/day_to$/${typeValue}`] = `Invalid value for '${item.code}': ${item.value}`
                  }

                  break
                case 'time_from':
                case 'time_to':
                  if (!/^([01]\d|2[0-3])[0-5]\d$/.test(item.value)) {
                    errorObj[`prvdr${i}/tags/time_to/${typeValue}`] =
                      `Invalid time format for '${item.code}': ${item.value}`
                  }
                  break
                case 'location':
                  if (!prvdrLocationIds.has(item.value)) {
                    errorObj[`prvdr${i}/tags/location/${typeValue}`] =
                      `Invalid location value as it's unavailable in location/ids`
                  }
                  break
                case 'type':
                  break
                default:
                  errorObj[`prvdr${i}/tags/tag_timings/${typeValue}`] = `Invalid list.code for 'timing': ${item.code}`
              }
            }

            const dayFromItem = tag.list.find((item: any) => item.code === 'day_from')
            const dayToItem = tag.list.find((item: any) => item.code === 'day_to')
            const timeFromItem = tag.list.find((item: any) => item.code === 'time_from')
            const timeToItem = tag.list.find((item: any) => item.code === 'time_to')

            if (dayFromItem && dayToItem && timeFromItem && timeToItem) {
              const dayFrom = parseInt(dayFromItem.value, 10)
              const dayTo = parseInt(dayToItem.value, 10)
              const timeFrom = parseInt(timeFromItem.value, 10)
              const timeTo = parseInt(timeToItem.value, 10)

              if (dayTo < dayFrom) {
                errorObj[`prvdr${i}/tags/day_from/${typeValue}`] =
                  "'day_to' must be greater than or equal to 'day_from'"
              }

              if (timeTo <= timeFrom) {
                errorObj[`prvdr${i}/tags/time_from/${typeValue}`] = "'time_to' must be greater than 'time_from'"
              }
            }
          }

          if (timingsAll.length > 0) {
            if (timingsAll.length > 1) {
              errorObj[`prvdr${i}tags/timing/All`] = `The timings object for 'All' should be provided once!`
            }
            checkTimingTag(timingsAll[0])
          }

          if (timingsOther.length > 0) {
            timingsOther.forEach((tagTimings: any) => {
              checkTimingTag(tagTimings)
            })
            onSearchFFTypeSet.forEach((type: any) => {
              if (!arrTimingTypes.has(type)) {
                errorObj[`prvdr${i}/tags/timing/${type}`] = `The timings object must be present for ${type} in the tags`
              }
              arrTimingTypes.forEach((type: any) => {
                if (type != 'Order' && type != 'All' && !onSearchFFTypeSet.has(type)) {
                  errorObj[`prvdr${i}/tags/timing/${type}`] =
                    `The timings object ${type} is not present in the onSearch fulfillments`
                }
              })
              if (!arrTimingTypes.has('Order')) {
                errorObj[`prvdr${i}/tags/timing/order`] = `The timings object must be present for Order in the tags`
              }
            })
          }
        }
      } catch (error: any) {
        logger.error(
          `!!Error while checking serviceability and timing construct for bpp/providers[${i}], ${error.stack}`,
        )
      }

      try {
        logger.info(
          `Checking if catalog_link type in message/catalog/bpp/providers[${i}]/tags[1]/list[0] is link or inline`,
        )
        const tags = bppPrvdrs[i].tags

        let list: any = []
        tags.map((data: any) => {
          if (data.code == 'catalog_link') {
            list = data.list
          }
        })

        list.map((data: any) => {
          if (data.code === 'type') {
            if (data.value === 'link') {
              if (bppPrvdrs[0].items) {
                errorObj[`message/catalog/bpp/providers[0]`] =
                  `Items arrays should not be present in message/catalog/bpp/providers[${i}]`
              }
            }
          }
        })
      } catch (error: any) {
        logger.error(`Error while checking the type of catalog_link`)
      }

      i++
    }

    try {
      const fulfillments: any = onSearchCatalog['bpp/providers'][i]['fulfillments']
      fulfillments.forEach((fulfillment: any) => {
        const hasSelfPickupFulfillment = fulfillments.some((f: any) => f.type === 'Self-Pickup')

        const selfPickupTag = fulfillment.tags?.find(
          (tag: any) =>
            tag.code === 'timing' &&
            tag.list?.some((item: any) => item.code === 'type' && item.value === 'Self-Pickup'),
        )

        if (flow === '002') {
          // Flow is 002 => Self-Pickup fulfillment is required
          if (!hasSelfPickupFulfillment) {
            const key = `prvdr${i}fulfillment_self_pickup_required`
            errorObj[key] = `Provider[${i}] with flow=002 must have at least one fulfillment of type 'Self-Pickup'`
          }
        } else {
          // For all other flows => Self-Pickup timing tag is required and must be valid
          if (!selfPickupTag) {
            const key = `prvdr${i}tag_self_pickup_required`
            errorObj[key] = `Provider[${i}] with flow≠002 must have a 'timing' tag with list.type='Self-Pickup'`
          } else {
            // const timingKeys = ['day_from', 'day_to', 'time_from', 'time_to']
            const tagListMap = Object.fromEntries(selfPickupTag.list.map((t: any) => [t.code, t.value]))
            const locationId = tagListMap['location']

            if (locationId) {
              if (!prvdrLocId.has(locationId)) {
                const key = `prvdr${i}tag_timing_invalid_location`
                errorObj[key] =
                  `'location' in Self-Pickup timing tag must match one of the provider[${i}]'s location ids`
              }
            } else {
              const key = `prvdr${i}tag_timing_missing_location`
              errorObj[key] = `'location' is missing in Self-Pickup timing tag for provider[${i}]`
            }

            // Validate day_from/to are between 1 and 7
            ;['day_from', 'day_to'].forEach((code) => {
              const val = parseInt(tagListMap[code])
              if (isNaN(val) || val < 1 || val > 7) {
                const key = `prvdr${i}tag_timing_invalid_${code}`
                errorObj[key] = `Invalid value for ${code}: ${tagListMap[code]} in Self-Pickup timing tag`
              }
            })

            // Validate time_from/to format
            ;['time_from', 'time_to'].forEach((code) => {
              const val = tagListMap[code]
              if (!/^([01]\d|2[0-3])[0-5]\d$/.test(val)) {
                const key = `prvdr${i}tag_timing_invalid_${code}`
                errorObj[key] = `Invalid format for ${code}: ${val} in Self-Pickup timing tag (expected HHMM)`
              }
            })

            // Additional validation: time_to > time_from
            const tFrom = parseInt(tagListMap['time_from'])
            const tTo = parseInt(tagListMap['time_to'])
            if (!isNaN(tFrom) && !isNaN(tTo) && tTo <= tFrom) {
              const key = `prvdr${i}tag_timing_time_order`
              errorObj[key] = `'time_to' (${tTo}) must be greater than 'time_from' (${tFrom}) for Self-Pickup`
            }
          }
        }
      })
    } catch (error: any) {
      logger.error(`!!Errors while checking fulfillments in bpp/providers[${i}], ${error.stack}`)
    }

    setValue('onSearchItems', itemsArray)
    setValue(`${ApiSequence.ON_SEARCH}prvdrsId`, prvdrsId)
    setValue(`${ApiSequence.ON_SEARCH}prvdrLocId`, prvdrLocId)
    setValue(`${ApiSequence.ON_SEARCH}itemsId`, itemsId)
  } catch (error: any) {
    logger.error(`!!Error while checking Providers info in /${constants.ON_SEARCH}, ${error.stack}`)
  }
  try {
    logger.info(`Checking for errors in default flow in /${constants.ON_SEARCH}`)
    const providers = data.message.catalog['bpp/providers']

    providers.forEach((provider: any) => {
      let customGroupDetails: any = {}

      provider?.categories.forEach((category: any) => {
        const id: string = category?.id
        const customGroupTag = category.tags.find(
          (tag: any) => tag.code === 'type' && tag.list.some((item: any) => item.value === 'custom_group'),
        )

        if (customGroupTag) {
          const configTag = category.tags.find((tag: any) => tag.code === 'config')
          const min = configTag ? parseInt(configTag.list.find((item: any) => item.code === 'min')?.value, 10) : 0
          const max = configTag ? parseInt(configTag.list.find((item: any) => item.code === 'max')?.value, 10) : 0

          if (min > max) {
            errorObj[`${provider.id}/categories/${id}`] = `The "min" is more than "max"`
          }
          customGroupDetails[id] = {
            min: min,
            max: max,
            numberOfDefaults: 0,
            numberOfElements: 0,
          }
        }
      })

      let combinedIds: any = []

      provider?.items.forEach((item: any) => {
        const typeTag = item.tags.find((tag: any) => tag.code === 'type')
        const typeValue = typeTag ? typeTag.list.find((listItem: any) => listItem.code === 'type')?.value : null

        if (typeValue === 'item') {
          const customGroupTags = item.tags.filter((tag: any) => tag.code === 'custom_group')
          combinedIds = customGroupTags.flatMap((tag: any) => tag.list.map((listItem: any) => listItem.value))
        } else if (typeValue === 'customization') {
          const parentTag = item.tags.find((tag: any) => tag.code === 'parent')
          const customizationGroupId = parentTag?.list.find((listItem: any) => listItem.code === 'id')?.value

          if (customizationGroupId && customGroupDetails[customizationGroupId]) {
            customGroupDetails[customizationGroupId].numberOfElements += 1

            const defaultParent = parentTag?.list.find(
              (listItem: any) => listItem.code === 'default' && listItem.value === 'yes',
            )
            if (defaultParent) {
              customGroupDetails[customizationGroupId].numberOfDefaults += 1

              const childTag = item.tags.find((tag: any) => tag.code === 'child')
              if (childTag) {
                const childIds = childTag.list.map((listItem: any) => listItem.value)
                combinedIds = [...combinedIds, ...childIds]
              }
            }
          }
        }
      })

      combinedIds.forEach((id: any) => {
        if (customGroupDetails[id]) {
          const group = customGroupDetails[id]
          const min = group.min
          const max = group.max

          if (group.numberOfElements <= max) {
            errorObj[`${provider.id}/categories/${id}/number_of_elements`] =
              'The number of elements in this customization group is less than the maximum that can be selected.'
          }

          if (min > 0 && group.numberOfDefaults < min) {
            errorObj[`${provider.id}/categories/${id}/number_of_defaults`] =
              'The number of defaults of this customization group is less than the minimum that can be selected.'
          }
        }
      })

      const customGroupIds = Object.keys(customGroupDetails)
      customGroupIds.forEach((id) => {
        const group = customGroupDetails[id]
        const max = group.max

        if (group.numberOfElements < max) {
          errorObj[`${provider.id}/categories/${id}/number_of_defaults`] =
            'The number of elements in this customization group is less than the maximum that can be selected.'
        }
      })
    })
  } catch (error: any) {
    logger.error(`Error while storing items of bpp/providers in itemsArray for /${constants.ON_SEARCH}, ${error.stack}`)
  }

  

  //Validating Offers
  try {
    logger.info(`Checking offers under bpp/providers`)

    // Iterate through bpp/providers
    for (let i in onSearchCatalog['bpp/providers']) {
      const offers = onSearchCatalog['bpp/providers'][i]?.offers ?? []
      if (!offers || !Array.isArray(offers)) {
        const key = `bpp/providers[${i}]/offers`
        errorObj[key] = `Offers must be an array in bpp/providers[${i}]`
        continue
      }

      offers.forEach((offer: any, offerIndex: number) => {
        // Validate mandatory fields
        if (!offer.id) {
          const key = `bpp/providers[${i}]/offers[${offerIndex}]/id`
          errorObj[key] = `Offer ID is mandatory for offers[${offerIndex}]`
          logger.error(`Offer ID is mandatory for offers[${offerIndex}]`)
        }

        if (!offer.descriptor || !offer.descriptor.code) {
          const key = `bpp/providers[${i}]/offers[${offerIndex}]/descriptor`
          errorObj[key] = `Descriptor with code is mandatory for offers[${offerIndex}]`
          logger.error(`Descriptor with code is mandatory for offers[${offerIndex}]`)
        }

        if (!offer.location_ids || !Array.isArray(offer.location_ids) || offer.location_ids.length === 0) {
          const key = `bpp/providers[${i}]/offers[${offerIndex}]/location_ids`
          errorObj[key] = `Location IDs array is mandatory for offers[${offerIndex}]`
          logger.error(`Location IDs array is mandatory for offers[${offerIndex}]`)
        }

        if (!offer.item_ids || !Array.isArray(offer.item_ids) || offer.item_ids.length === 0) {
          const key = `bpp/providers[${i}]/offers[${offerIndex}]/item_ids`
          errorObj[key] = `Item IDs array is mandatory for offers[${offerIndex}]`
          logger.error(`Item IDs array is mandatory for offers[${offerIndex}]`)
        }

        if (!offer.time || !offer.time.label || !offer.time.range || !offer.time.range.start || !offer.time.range.end) {
          const key = `bpp/providers[${i}]/offers[${offerIndex}]/time`
          errorObj[key] = `Time object with label and range (start/end) is mandatory for offers[${offerIndex}]`
          logger.error(`Time object with label and range (start/end) is mandatory for offers[${offerIndex}]`)
        }

        const tags = offer.tags
        if (!tags || !Array.isArray(tags)) {
          const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags`
          errorObj[key] =
            `Tags must be provided for offers[${offerIndex}] with descriptor code '${offer.descriptor?.code}'`
          logger.error(
            `Tags must be provided for offers[${offerIndex}] with descriptor code '${offer.descriptor?.code}'`,
          )
          return
        }

        // Validate based on offer type
        switch (offer.descriptor?.code) {
          case 'discount':
            // Validate 'qualifier'
            const qualifierDiscount = tags.find((tag: any) => tag.code === 'qualifier')
            if (!qualifierDiscount || !qualifierDiscount.list.some((item: any) => item.code === 'min_value')) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
              errorObj[key] =
                `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
            }

            // Validate 'benefit'
            const benefitDiscount = tags.find((tag: any) => tag.code === 'benefit')
            if (!benefitDiscount) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
              errorObj[key] =
                `'benefit' tag is required for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'benefit' tag is required for offers[${offerIndex}]`)
            } else {
              const valueTypeItem = benefitDiscount.list.find((item: any) => item.code === 'value_type')
              const valueItem = benefitDiscount.list.find((item: any) => item.code === 'value')
              const valueCapItem = benefitDiscount.list.find((item: any) => item.code === 'value_cap')

              if (!valueTypeItem) {
                const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]/value_type`
                errorObj[key] = `'value_type' is required in benefit tag for offers[${offerIndex}]`
                logger.error(`'value_type' is required in benefit tag for offers[${offerIndex}]`)
              }

              if (!valueItem) {
                const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]/value`
                errorObj[key] = `'value' is required in benefit tag for offers[${offerIndex}]`
                logger.error(`'value' is required in benefit tag for offers[${offerIndex}]`)
              } else {
                // Validate value is a proper number
                const value = valueItem.value
                if (isNaN(parseFloat(value)) || !/^-?\d+(\.\d+)?$/.test(value)) {
                  const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]/value`
                  errorObj[key] = `'value' in benefit tag must be a valid number for offers[${offerIndex}]`
                  logger.error(`'value' in benefit tag must be a valid number for offers[${offerIndex}]`)
                } else if (parseFloat(value) >= 0) {
                  const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]/value`
                  errorObj[key] = `'value' in 'benefit' tag must be a negative amount for offers[${offerIndex}]`
                  logger.error(`'value' in 'benefit' tag must be a negative amount for offers[${offerIndex}]`)
                }
              }

              // Validate value_cap if present
              if (valueCapItem) {
                const valueCap = valueCapItem.value
                if (isNaN(parseFloat(valueCap)) || !/^-?\d+(\.\d+)?$/.test(valueCap)) {
                  const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]/value_cap`
                  errorObj[key] = `'value_cap' in benefit tag must be a valid number for offers[${offerIndex}]`
                  logger.error(`'value_cap' in benefit tag must be a valid number for offers[${offerIndex}]`)
                }
              }
            }
            break

          case 'buyXgetY':
            // Validate 'qualifier'
            const qualifierBuyXgetY = tags.find((tag: any) => tag.code === 'qualifier')
            if (
              !qualifierBuyXgetY ||
              !qualifierBuyXgetY.list.some((item: any) => item.code === 'min_value') ||
              !qualifierBuyXgetY.list.some((item: any) => item.code === 'item_count')
            ) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
              errorObj[key] =
                `'qualifier' tag must include 'min_value' and 'item_count' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'qualifier' tag must include 'min_value' and 'item_count' for offers[${offerIndex}]`)
            }

            // Validate 'benefit'
            const benefitBuyXgetY = tags.find((tag: any) => tag.code === 'benefit')
            if (!benefitBuyXgetY || !benefitBuyXgetY.list.some((item: any) => item.code === 'item_count')) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
              errorObj[key] =
                `'benefit' tag must include 'item_count' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'benefit' tag must include 'item_count' for offers[${offerIndex}]`)
            }
            break

          case 'freebie':
            // Validate 'qualifier'
            const qualifierFreebie = tags.find((tag: any) => tag.code === 'qualifier')
            if (!qualifierFreebie || !qualifierFreebie.list.some((item: any) => item.code === 'min_value')) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
              errorObj[key] =
                `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
            }

            // Validate 'benefit'
            const benefitFreebie = tags.find((tag: any) => tag.code === 'benefit')
            if (
              !benefitFreebie ||
              !benefitFreebie.list.some((item: any) => item.code === 'item_count') ||
              !benefitFreebie.list.some((item: any) => item.code === 'item_id') ||
              !benefitFreebie.list.some((item: any) => item.code === 'item_value')
            ) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
              errorObj[key] =
                `'benefit' tag must include 'item_count', 'item_id', and 'item_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(
                `'benefit' tag must include 'item_count', 'item_id', and 'item_value' for offers[${offerIndex}]`,
              )
            }
            break

          case 'slab':
            // Validate 'qualifier'
            const qualifierSlab = tags.find((tag: any) => tag.code === 'qualifier')
            if (!qualifierSlab || !qualifierSlab.list.some((item: any) => item.code === 'min_value')) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
              errorObj[key] =
                `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
            }

            // Validate 'benefit'
            const benefitSlab = tags.find((tag: any) => tag.code === 'benefit')
            if (
              !benefitSlab ||
              !benefitSlab.list.some((item: any) => item.code === 'value') ||
              !benefitSlab.list.some((item: any) => item.code === 'value_type') ||
              !benefitSlab.list.some((item: any) => item.code === 'value_cap')
            ) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
              errorObj[key] =
                `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(
                `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}]`,
              )
            }
            break

          case 'combo':
            // Validate 'qualifier'
            const qualifierCombo = tags.find((tag: any) => tag.code === 'qualifier')
            if (
              !qualifierCombo ||
              !qualifierCombo.list.some((item: any) => item.code === 'min_value') ||
              !qualifierCombo.list.some((item: any) => item.code === 'item_id')
            ) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
              errorObj[key] =
                `'qualifier' tag must include 'min_value' and 'item_id' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'qualifier' tag must include 'min_value' and 'item_id' for offers[${offerIndex}]`)
            }

            // Validate 'benefit'
            const benefitCombo = tags.find((tag: any) => tag.code === 'benefit')
            if (
              !benefitCombo ||
              !benefitCombo.list.some((item: any) => item.code === 'value') ||
              !benefitCombo.list.some((item: any) => item.code === 'value_type') ||
              !benefitCombo.list.some((item: any) => item.code === 'value_cap')
            ) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
              errorObj[key] =
                `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(
                `'benefit' tag must include 'value', 'value_type', and 'value_cap' for offers[${offerIndex}]`,
              )
            }
            break

          case 'delivery':
            // Validate 'qualifier'
            const qualifierDelivery = tags.find((tag: any) => tag.code === 'qualifier')
            if (!qualifierDelivery || !qualifierDelivery.list.some((item: any) => item.code === 'min_value')) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
              errorObj[key] =
                `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
            }

            // Validate 'benefit'
            const benefitDelivery = tags.find((tag: any) => tag.code === 'benefit')
            if (
              !benefitDelivery ||
              !benefitDelivery.list.some((item: any) => item.code === 'value') ||
              !benefitDelivery.list.some((item: any) => item.code === 'value_type')
            ) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
              errorObj[key] =
                `'benefit' tag must include 'value' and 'value_type' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'benefit' tag must include 'value' and 'value_type' for offers[${offerIndex}]`)
            }
            break

          case 'exchange':
            // Validate 'qualifier'
            const qualifierExchange = tags.find((tag: any) => tag.code === 'qualifier')
            if (!qualifierExchange || !qualifierExchange.list.some((item: any) => item.code === 'min_value')) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[qualifier]`
              errorObj[key] =
                `'qualifier' tag must include 'min_value' for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'qualifier' tag must include 'min_value' for offers[${offerIndex}]`)
            }

            // Validate that benefits should not exist or should be empty
            const benefitExchange = tags.find((tag: any) => tag.code === 'benefit')
            if (benefitExchange && benefitExchange.list.length > 0) {
              const key = `bpp/providers[${i}]/offers[${offerIndex}]/tags[benefit]`
              errorObj[key] =
                `'benefit' tag must not include any values for offers[${offerIndex}] when offer.descriptor.code = ${offer.descriptor.code}`
              logger.error(`'benefit' tag must not include any values for offers[${offerIndex}]`)
            }
            break

          default:
            logger.info(`No specific validation required for offer type: ${offer.descriptor?.code}`)
        }
      })
    }
  } catch (error: any) {
    logger.error(`Error while checking offers under bpp/providers: ${error.stack}`)
  }

  return Object.keys(errorObj).length > 0 && errorObj
}

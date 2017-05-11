/**
 * Module Dependencies
 */
// ...
// e.g.
// var _ = require('lodash');
// var mysql = require('node-mysql');
// ...

var Vogels = require('vogels');
var AWS = Vogels.AWS;
var _ = require('lodash');
var DynamoDB = false;
var filters = {
  //?where={"name":{"null":true}}
  null: false,
  //?where={"name":{"notNull":true}}
  notNull: false,
  //?where={"name":{"equals":"firstName lastName"}}
  equals: true,
  //?where={"name":{"ne":"firstName lastName"}}
  ne: true,
  //?where={"name":{"lte":"firstName lastName"}}
  lte: true,
  //?where={"name":{"lt":"firstName lastName"}}
  lt: true,
  //?where={"name":{"gte":"firstName lastName"}}
  gte: true,
  //?where={"name":{"gt":"firstName lastName"}}
  gt: true,
  //?where={"name":{"contains":"firstName lastName"}}
  contains: true,
  //?where={"name":{"contains":"firstName lastName"}}
  notContains: true,
  //?where={"name":{"beginsWith":"firstName"}}
  beginsWith: true,
  //?where={"name":{"in":["firstName lastName", "another name"]}}
  in: true,
  //?where={"name":{"between":["firstName, "lastName""]}}
  between: true
};

/**
 * Sails Boilerplate Adapter
 *
 * Most of the methods below are optional.
 *
 * If you don't need / can't get to every method, just implement
 * what you have time for.  The other methods will only fail if
 * you try to call them!
 *
 * For many adapters, this file is all you need.  For very complex adapters, you may need more flexiblity.
 * In any case, it's probably a good idea to start with one file and refactor only if necessary.
 * If you do go that route, it's conventional in Node to create a `./lib` directory for your private submodules
 * and load them at the top of the file with other dependencies.  e.g. var update = `require('./lib/update')`;
 */
module.exports = (function () {

  // Hold connections for this adapter
  var connections = {};

  // You'll want to maintain a reference to each collection
  // (aka model) that gets registered with this adapter.
  var _collectionReferences = {};
  var _vogelsReferences = {};

  var _definedTables = {};

  // You may also want to store additional, private data
  // per-collection (esp. if your data store uses persistent
  // connections).
  //
  // Keep in mind that models can be configured to use different databases
  // within the same app, at the same time.
  //
  // i.e. if you're writing a MariaDB adapter, you should be aware that one
  // model might be configured as `host="localhost"` and another might be using
  // `host="foo.com"` at the same time.  Same thing goes for user, database,
  // password, or any other config.
  //
  // You don't have to support this feature right off the bat in your
  // adapter, but it ought to get done eventually.
  //
  // Sounds annoying to deal with...
  // ...but it's not bad.  In each method, acquire a connection using the config
  // for the current model (looking it up from `_modelReferences`), establish
  // a connection, then tear it down before calling your method's callback.
  // Finally, as an optimization, you might use a db pool for each distinct
  // connection configuration, partioning pools for each separate configuration
  // for your adapter (i.e. worst case scenario is a pool for each model, best case
  // scenario is one single single pool.)  For many databases, any change to
  // host OR database OR user OR password = separate pool.
  var _dbPools = {};

  var adapter = {

    identity: 'sails-dynamodb',
    pkFormat: 'string',

    keyId: 'id',

    // Set to true if this adapter supports (or requires) things like data types, validations, keys, etc.
    // If true, the schema for models using this adapter will be automatically synced when the server starts.
    // Not terribly relevant if your data store is not SQL/schemaful.

    // This doesn't make sense for dynamo, where the schema parts are locked-down during table creation.
    syncable: false,


    // Default configuration for collections
    // (same effect as if these properties were included at the top level of the model definitions)
    defaults: {
      accessKeyId: null,
      secretAccessKey: null,
      region: 'us-west-1',
      // For example:
      // port: 3306,
      // host: 'localhost',
      // schema: true,
      // ssl: false,
      // customThings: ['eh']

      // If setting syncable, you should consider the migrate option,
      // which allows you to set how the sync will be performed.
      // It can be overridden globally in an app (config/adapters.js)
      // and on a per-model basis.
      //
      // IMPORTANT:
      // `migrate` is not a production data migration solution!
      // In production, always use `migrate: safe`
      //
      // drop   => Drop schema and data, then recreate it
      // alter  => Drop/add columns as necessary.
      // safe   => Don't change anything (good for production DBs)

      //Indices currently never change in dynamo
      migrate: 'safe',
//    schema: false
    },

    _createModel: function (collectionName) {

      var collection = _collectionReferences[collectionName];

      // Attrs with primaryKeys
      var primaryKeys = _.pick(collection.definition, function(attr) { return !!attr.primaryKey } );
      var primaryKeyNames =_.keys(primaryKeys);

      if (primaryKeyNames.length < 1 || primaryKeyNames.length > 2) {
        throw new Error('Must have one or two primary key attributes.');
      }

      // One primary key, then it's a hash
      if (primaryKeyNames.length == 1) {
        collection.definition[primaryKeyNames[0]].primaryKey = 'hash';
      }

      // Vogels adds an 's'.  So let's remove an 's'.
      var vogelsCollectionName  = collectionName[collectionName.length-1] === 's' ?

                                      collectionName.slice(0, collectionName.length-1) :
                                      collectionName;

      var vogelsModel = Vogels.define(vogelsCollectionName, function (schema) {

        var columns = collection.definition;

        var indices = {};

        // set columns
        for (var columnName in columns) {

          var attributes = columns[columnName];

          if (typeof attributes !== "function") {

            // Add column to Vogel model
            adapter._setColumnType(schema, columnName, attributes);

            // Save set indices
            var index;
            var indexParts;
            var indexName;
            var indexType;

            if ("index" in attributes && attributes.index !== 'secondary') {

              index = attributes.index;

              if (_.isArray(index)){
                index.forEach((oneIndex) => {
                  indexParts = adapter._parseIndex(oneIndex, columnName);
                  indexName = indexParts[0];
                  indexType = indexParts[1];

                  if (typeof indices[indexName] === 'undefined') {
                    indices[indexName] = {};
                  }

                  indices[indexName][indexType] = columnName;
                });
              }else{
                indexParts = adapter._parseIndex(index, columnName);
                indexName = indexParts[0];
                indexType = indexParts[1];

                if (typeof indices[indexName] === 'undefined') {
                  indices[indexName] = {};
                }

                indices[indexName][indexType] = columnName;
              }

            }

          }

        }

        // Set global secondary indices
        for (indexName in indices) {
          schema.globalIndex(indexName, indices[indexName]);
        }

      });

      // Cache Vogels model
      _vogelsReferences[collectionName] = vogelsModel;

      Vogels.createTables(function (err) {
        if (err) {
          console.log('Error creating tables: ', err);
        } else {
          console.log('Tables have been created');
        }
      });


      return vogelsModel;

    },

    _getModel: function(collectionName) {
      return _vogelsReferences[collectionName] || this._createModel(collectionName);
    },

    _getPrimaryKeys: function (collectionName) {

      var lodash = _;
      var collection = _collectionReferences[collectionName];

      var maps = lodash.mapValues(collection.definition, "primaryKey");
      //            console.log(results);
      var list = lodash.pick(maps, function (value, key) {
        return typeof value !== "undefined";
      });

      var primaryKeys = lodash.keys(list);

      return primaryKeys;
    },

    _keys: function (collectionName) {
      var lodash = _;
      var collection = _collectionReferences[collectionName];

      var list = lodash.pick(collection.definition, function (value, key) {
        return (typeof value !== "undefined");
      });
      return lodash.keys(list);
    },

    _indexes: function (collectionName) {
      var lodash = _;
      var collection = _collectionReferences[collectionName];

      var list = lodash.pick(collection.definition, function (value, key) {
        return ("index" in value && value.index === true)
      });
      return lodash.keys(list);
    },

    // index: 'secondary'
    _getLocalIndices: function(collectionName) {

    },

    // index: 'indexName-fieldType' (i.e. 'users-hash' and 'users-range')
    _getGlobalIndices: function(collectionName) {

    },

    _parseIndex: function(index, columnName) {

      // Two helpers
      var stringEndsWith = function(str, needle) {

          if (str.indexOf(needle) !== -1 &&
              str.indexOf(needle) === str.length-needle.length) {
              return true;
          } else {
              return false;
          }

      }

      var removeSuffixFromString = function(str, suffix) {

          if (stringEndsWith(str, suffix)) {
              return str.slice(0, str.length-suffix.length);
          } else {
              return str;
          }

      }

      var indexName;
      var indexType;

      if (index === true) {

        indexName = columnName;
        indexType = 'hashKey';
      } else if (stringEndsWith(index, '-hash')) {

        indexName = removeSuffixFromString(index, '-hash');
        indexType = 'hashKey';
      } else if (stringEndsWith(index, '-range')) {

        indexName = removeSuffixFromString(index, '-range');
        indexType = 'rangeKey';
      } else {
        throw new Error('Index must be a hash or range.');
      }

      return [indexName, indexType];

    },

    /**
     *
     * This method runs when a model is initially registered
     * at server-start-time.  This is the only required method.
     *
     * @param  string   collection [description]
     * @param  {Function} cb         [description]
     * @return {[type]}              [description]
     */

     registerConnection: function (connection, collections, cb) {

      if (!connection.identity) return cb(Errors.IdentityMissing);
      if (connections[connection.identity]) return cb(Errors.IdentityDuplicate);

      try {

        AWS.config.update({
          "accessKeyId": connection.accessKeyId,
          "secretAccessKey": connection.secretAccessKey,
          "region": connection.region,
          "endpoint": connection.endPoint,
          "logger": connection.logger
        });
      } catch (e) {

        e.message = e.message + ". Please make sure you added the right keys to your adapter config";
        return cb(e)
      }

      // Keep a reference to these collections
      _collectionReferences = collections;

      // Create Vogels models for the collections
      _.forOwn(collections, function(coll, collName) {
        adapter._createModel(collName);
      });

      cb();
    },

    /**
     * Fired when a model is unregistered, typically when the server
     * is killed. Useful for tearing-down remaining open connections,
     * etc.
     *
     * @param  {Function} cb [description]
     * @return {[type]}      [description]
     */
    teardown: function (connection, cb) {
      cb();
    },


    /**
     *
     * REQUIRED method if integrating with a schemaful
     * (SQL-ish) database.
     *
     * @param  {[type]}   collectionName [description]
     * @param  {[type]}   definition     [description]
     * @param  {Function} cb             [description]
     * @return {[type]}                  [description]
     */
    define: function (connection, collectionName, definition, cb) {
//sails.log.silly("adaptor::define");
//sails.log.silly("::collectionName", collectionName);
//sails.log.silly("::definition", definition);
//sails.log.silly("::model", adapter._getModel(collectionName));

      // If you need to access your private data for this collection:
      var collection = _collectionReferences[collectionName];

      if (!_definedTables[collectionName]) {
        var table = adapter._getModel(collectionName);

        _definedTables[collectionName] = table;
        Vogels.createTables({
          collectionName: {readCapacity: 1, writeCapacity: 1}
        }, function (err) {
          if (err) {
            //sails.log.error('Error creating tables', err);
            cb(err);
          }
          else {
//                    console.log('table are now created and active');
            cb();
          }
        });
      }
      else {
        cb();
      }

      // Define a new "table" or "collection" schema in the data store
    },

    /**
     *
     * REQUIRED method if integrating with a schemaful
     * (SQL-ish) database.
     *
     * @param  {[type]}   collectionName [description]
     * @param  {Function} cb             [description]
     * @return {[type]}                  [description]
     */
    describe: function (connection, collectionName, cb) {
//sails.log.silly("adaptor::describe");
//console.log("::connection",connection);
//console.log("::collection",collectionName);

      // If you need to access your private data for this collection:
      var collection = _collectionReferences[collectionName];
//console.log("::collection.definition",collection.definition);

      // Respond with the schema (attributes) for a collection or table in the data store
      var attributes = {};

      // extremly simple table names
      var tableName = collectionName.toLowerCase() + 's'; // 's' is vogels spec
      var Endpoint = collection.connections[connection]['config']['endPoint'];
      if (DynamoDB === false) {
        DynamoDB = new AWS.DynamoDB(
          Endpoint ? {endpoint: new AWS.Endpoint(Endpoint)}
            : null
        );
        if (Endpoint)
          Vogels.dynamoDriver(DynamoDB);
      }

      DynamoDB.describeTable({TableName: tableName}, function (err, res) {
        if (err) {
          if ('code' in err && err['code'] === 'ResourceNotFoundException') {
            cb();
          }
          else {
            //sails.log.error('Error describe tables' + __filename, err);
            cb(err);
          }
//                console.log(err); // an error occurred
        }
        else {
//                console.log(data); // successful response
          cb();
        }
      });
    },


    /**
     *
     *
     * REQUIRED method if integrating with a schemaful
     * (SQL-ish) database.
     *
     * @param  {[type]}   collectionName [description]
     * @param  {[type]}   relations      [description]
     * @param  {Function} cb             [description]
     * @return {[type]}                  [description]
     */
    drop: function (connection, collectionName, relations, cb) {
//sails.log.silly("adaptor::drop", collectionName);
      // If you need to access your private data for this collection:
      var collection = _collectionReferences[collectionName];
//sails.log.error('drop: not supported')
      // Drop a "table" or "collection" schema from the data store
      cb();
    },


    // OVERRIDES NOT CURRENTLY FULLY SUPPORTED FOR:
    //
    // alter: function (collectionName, changes, cb) {},
    // addAttribute: function(collectionName, attrName, attrDef, cb) {},
    // removeAttribute: function(collectionName, attrName, attrDef, cb) {},
    // alterAttribute: function(collectionName, attrName, attrDef, cb) {},
    // addIndex: function(indexName, options, cb) {},
    // removeIndex: function(indexName, options, cb) {},


    /**
     *
     * REQUIRED method if users expect to call Model.find(), Model.findOne(),
     * or related.
     *
     * You should implement this method to respond with an array of instances.
     * Waterline core will take care of supporting all the other different
     * find methods/usages.
     *
     * @param  {[type]}   collectionName [description]
     * @param  {[type]}   options        [description]
     * @param  {Function} cb             [description]
     * @return {[type]}                  [description]
     */
    find: function (connection, collectionName, options, cb) {
      //sails.log.silly("adaptor::find", collectionName);
      //sails.log.silly("::option", options);

      var collection = _collectionReferences[collectionName],
        model        = adapter._getModel(collectionName),
        query        = null,
        error;


      // Options object is normalized for you:
      //
      // options.where
      // options.limit
      // options.skip
      // options.

      // Filter, paginate, and sort records from the datastore.
      // You should end up w/ an array of objects as a result.
      // If no matches were found, this will be an empty array.

      if (options && 'where' in options && _.isObject(options.where)) {

        var wheres    = options.where,
            whereExt  = this._getSubQueryWhereConditions(options),
            indexing  = adapter._whichIndex(collectionName, ((whereExt) ? whereExt : wheres )),
            hash      = indexing.hash,
            range     = indexing.range,
            indexName = indexing.index,
            scanning  = false;

        if (indexing) {
          // console.log("USING INDEX")
          // console.log(indexing);
           query = model.query(options.where[hash])
          delete options.where[hash];

          if (indexName && indexName != 'primary') {
            query.usingIndex(indexName);
          }

          if (range) {

            error = adapter._applyQueryFilter(query, 'where', range, options.where[range]);
            if (error) return cb(error);

            delete options.where[range];
          }

        } else {
          scanning = true;
          query = model.scan();
        }

        var queryOp = scanning ? 'where' : 'filter';
        for (var key in options.where) {

          // Using startKey?
          if (key == 'startKey') {

            try {
              if (_.isString(options.where.startKey)){
                query.startKey(JSON.parse(options.where[key]));
              }else{
                query.startKey(options.where.startKey);
              }
            } catch (e) {

              return cb("Wrong start key format :" + e.message);
            }

          } else {

            var condition = (whereExt) ? whereExt : options.where[key];
            if (whereExt) {
              for (var subKey in condition) {
                error = adapter._applyQueryFilter(query, queryOp, subKey, condition[subKey]);
                if (error) return cb(error);
              }
              options.where = whereExt;
            } else {
              error = adapter._applyQueryFilter(query, queryOp, key, condition);
              if (error) return cb(error);
            }
          }
        }
      }

      query = adapter._searchCondition(query, options, model);
      this._findQuery(adapter, collection, query, false, cb);
    },

    /**
     * _findQuery
     * @description :: Return result if found. If not and the developer set a limit
                       on the number of entries to return, then we must keep
                       scanning the DB until the end is reached or until a result is returned
     * @author      :: Matt McCarty (https://github.com/mattmccarty)
     * @param       :: object   adapter     - Current sails-dynamodb instance
     * @param       :: object   collection  - Collection reference
     * @param       :: object   query       - Current query
     * @param       :: object   startKey    - Contains primary key of record where the search should start
     * @param       :: function callback
     * @return      :: callback(err, results)
     */
    _findQuery: function(adapter, collection, query, startKey, cb) {
      var _self = this;

      if (startKey) {
        query.request = query.request || {};
        query.request.ExclusiveStartKey = startKey;
      }

      query.exec(function(err, res) {
        if (!err) {
          // The developer requested a specific number of items, so loop over each DB entry
          // until the end of the db table is reached or until a result is found
          if (res && res.Count <= 0 && res.LastEvaluatedKey && res.LastEvaluatedKey.id) {
            var lastKey = {
              id: { S: res.LastEvaluatedKey.id },
            }
            return adapter._findQuery(adapter, collection, query, lastKey, cb);
          }

          adapter._valueDecode(collection.definition, res.attrs);
          cb(null, adapter._resultFormat(res));
        }
        else {
          cb(err);
        }
      });
    },

    /**
     * _getSubQueryWhereConditions
     * @description :: Handle where objects that contain subquery arrays (i.e: and: [], or: [], etc).
     *                 For consistency, This is useful when using dynamo and mongo data connections
     *                 in the same project.
     * @author      :: Matt McCarty (https://github.com/mattmccarty)
     * @param       :: object
     * @return      :: Object filled with 'where' values or false
     */
    _getSubQueryWhereConditions: function(options) {
        var wheresCurrent       = _.keys(options.where),
            conditionalOperator = 'AND',
            wheres              = [],
            whereExt            = false,
            count               = 0;

        for (var key in wheresCurrent) {
          var where = options.where[wheresCurrent[key]];
          if (!_.isArray(where)) {
            wheres.push(wheresCurrent[key]);
            continue;
          }

          if (typeof wheresCurrent[key] === 'string' && wheresCurrent[key].toUpperCase() === 'OR') {
              conditionalOperator =  'OR';
          }

          for (var arrKey in where) {
            if (typeof where[arrKey] !== 'object') {
              continue;
            }

            var subKeys = _.keys(where[arrKey]);

            // Concat unique keys
            wheres = _.union(wheres, subKeys);

            for (var subKey in subKeys) {
              if (!whereExt) whereExt   = {};
              whereExt[subKeys[subKey]] = where[arrKey][subKeys[subKey]];
              count++;
            }
          }
        }

        if (whereExt && count > 1) {
            whereExt.ConditionalOperator = conditionalOperator;
        }

        return whereExt;
    },

    _applyQueryFilter: function(query, op, key, condition) {
        try {

          if (key === 'ConditionalOperator' && query.request) {
            query.request.ConditionalOperator = condition;
          } else if (_.isString(condition) || _.isNumber(condition)) {

            query[op](key).equals(condition);

          } else if (_.isArray(condition)) {
            query[op](key).in(condition);

          } else if (_.isObject(condition)) {

            var filter = _.keys(condition)[0];

            if (filter in filters) {
              query[op](key)[filter](filters[filter] ? condition[filter] : null);

            } else {
              throw new Error("Wrong filter given :" + filter);
            }

          } else {

            throw new Error("Wrong filter given :" + filter);
          }

        } catch (e) {

          return e;
        }
    },

    // Return {index: 'name', hash: 'field1', range:'field2'}
    // Primary hash and range > primary hash and secondary range > global secondary hash and range
    // > primary hash > global secondary hash > no index/primary
    _whichIndex: function(collectionName, fields) {

      var columns = _collectionReferences[collectionName].definition;

      var primaryHash         = false;
      var primaryRange        = false;
      var secondaryRange      = false;
      var globalHash          = false;
      var globalRange         = false;

      var globalIndexName;

      // holds all index info from fields
      var indices = {};

      // temps for loop
      var fieldName;
      var column;
      var indexInfo;
      var indexName;
      var indexType;

      if (!(_.isArray(fields))){
        fields = Object.keys(fields);
      }

      // console.log("FIELDS")
      // console.log(fields);

      for (var i = 0; i < fields.length; i++) {

        fieldName = fields[i];
        column = columns[fieldName];

        if (column === undefined){ // happens in the case of startKey
          continue;
        }

        // set primary hash
        if (column.primaryKey){
          if (column.primaryKey === true || column.primaryKey === 'hash'){
            primaryHash = fieldName;
          }else if (column.primaryKey === 'range') {
            primaryRange = fieldName;
          }
        }

        // using secondary or GSIs
        if (column.index){
          // console.log("COLUMN.INDEX")
          // console.log(column.index)
          if (_.isArray(column.index)){
            column.index.forEach((oneIndex) => {
              if (oneIndex === 'secondary'){
                secondaryRange = fieldName;
              }else{
                indexInfo = adapter._parseIndex(oneIndex, fieldName);
                indexName = indexInfo[0];
                indexType = indexInfo[1];

                if (typeof indices[indexName] === 'undefined') {
                  indices[indexName] = {};
                }

                indices[indexName][indexType] = fieldName;
              }
            });
            // throw new Error(`No support yet for multiple non-primary indexes, ${fieldName} = ${column.index}`);
          }else if (column.index === 'secondary'){
            secondaryRange = fieldName;
          }else{
            indexInfo = adapter._parseIndex(column.index, fieldName);
            indexName = indexInfo[0];
            indexType = indexInfo[1];

            if (typeof indices[indexName] === 'undefined') {
              indices[indexName] = {};
            }

            indices[indexName][indexType] = fieldName;
          }
        }

      }

      // console.log("INDICES")
      // console.log(indices)

      // set global secondary hash info
      var indicesHashed;
      var indicesRanged;

      // pick out those with just a hash key
      var indicesHashed = _.pick(indices, function(ind) {
        return !!ind.hashKey && !ind.rangeKey;
      });

      // pick out those with a hash and a range key
      var indicesRanged = _.pick(indices, function(ind) {
        return !!ind.hashKey && !!ind.rangeKey;
      });

      // found a good ranged global secondary index?
      if (!_.isEmpty(indicesRanged)) {

        globalIndexName = Object.keys(indicesRanged)[0];
        globalHash  = indicesRanged[globalIndexName].hashKey;
        globalRange = indicesRanged[globalIndexName].rangeKey;

      } else if (!_.isEmpty(indicesHashed)) {

        globalIndexName = Object.keys(indicesHashed)[0];
        globalHash = indicesHashed[globalIndexName].hashKey;

      }

      if (primaryHash && primaryRange) {

        return {
          index: 'primary',
          hash:  primaryHash,
          range: primaryRange
        }

      } else if (primaryHash && secondaryRange) {

        return {
          index: secondaryRange+'Index', // per Vogels
          hash:  primaryHash,
          range: secondaryRange
        }

      } else if (globalHash && globalRange) {

        return {
          index: globalIndexName,
          hash:  globalHash,
          range: globalRange
        }

      } else if (primaryHash) {

        return {
          index: 'primary',
          hash:  primaryHash
        }

      } else if (globalHash) {

        return {
          index: globalIndexName,
          hash:  globalHash
        }

      } else {

        return false;
      }

    },

    /**
     * search condition
     * @param query
     * @param options
     * @returns {*}
     * @private
     */
    _searchCondition: function (query, options, model) {
      if (!query) {
        query = model.scan();
      }

      if (!options) {
        return query;
      }

      if ('sort' in options) {

        //according to http://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html#DDB-Query-request-ScanIndexForward
        var sort = _.keys(options.sort)[0];

        if (sort == 1) {
          query.ascending();
        }
        else if (sort == -1) {
          query.descending();
        }
      }

      if ('limit' in options) {

        query.limit(options.limit);
      } else {

        query.loadAll();
      }

      return query;
    },



    /**
     *
     * REQUIRED method if users expect to call Model.create() or any methods
     *
     * @param  {[type]}   collectionName [description]
     * @param  {[type]}   values         [description]
     * @param  {Function} cb             [description]
     * @return {[type]}                  [description]
     */create: function (connection, collectionName, values, cb) {
//sails.log.silly("adaptor::create", collectionName);
//sails.log.silly("values", values);
//console.log("collection", _modelReferences[collectionName]);

      var Model = adapter._getModel(collectionName);

      // If you need to access your private data for this collection:
      var collection = _collectionReferences[collectionName];
      adapter._valueEncode(collection.definition, values);

      // Create a single new model (specified by `values`)
      var current = Model.create(values, function (err, res) {
        if (err) {
          //sails.log.error(__filename + ", create error:", err);
          err.stack = '';
          cb(err);
        }
        else {
          adapter._valueDecode(collection.definition, res.attrs);
//                console.log('add model data',res.attrs);
          // Respond with error or the newly-created record.
          cb(null, res.attrs);
        }
      });
    },


    //

    /**
     *
     *
     * REQUIRED method if users expect to call Model.update()
     *
     * @param  {[type]}   collectionName [description]
     * @param  {[type]}   options        [description]
     * @param  {[type]}   values         [description]
     * @param  {Function} cb             [description]
     * @return {[type]}                  [description]
     */
    update: function (connection, collectionName, options, values, cb) {
//sails.log.silly("adaptor::update", collectionName);
//sails.log.silly("::options", options);
//sails.log.silly("::values", values);
      var Model = adapter._getModel(collectionName);
      var primaryKeys = adapter._getPrimaryKeys(collectionName);

      // If you need to access your private data for this collection:
      var collection = _collectionReferences[collectionName];
      adapter._valueEncode(collection.definition, values);

      // id filter (bug?)
      if (adapter.keyId in values && typeof values[adapter.keyId] === 'number') {
        if ('where' in options && adapter.keyId in options.where) {
          values[adapter.keyId] = options.where[adapter.keyId];
        }
      }

      // 1. Filter, paginate, and sort records from the datastore.
      //    You should end up w/ an array of objects as a result.
      //    If no matches were found, this will be an empty array.
      //
      // 2. Update all result records with `values`.
      //
      // (do both in a single query if you can-- it's faster)

      // Move primary keys to values (Vogels-style) so rest of wheres can be used for expected clause.
      // Actually, seems like the primary key has to stay in the wheres so as not to create a new item.
      var primaryKeyName;
      for (var i = 0; i < primaryKeys.length; i++) {

        primaryKeyName = primaryKeys[i];

        if (options.where[primaryKeyName]) {
          values[primaryKeyName] = options.where[primaryKeyName];
        }

      }

      var vogelsOptions = !_.isEmpty(options.where) ? { expected: options.where } : {};

//console.log(updateValues);
      Model.update(values, vogelsOptions, function (err, res) {
        if (err) {

          //sails.log.error('Error update data' + __filename, err);

          // Deal with AWS's funny way of telling us it couldnt update that item
          if (err.code == 'ConditionalCheckFailedException') {

            cb(null, []);
          } else {

            cb(err);
          }

        } else {
//                console.log('add model data',res.attrs);
          adapter._valueDecode(collection.definition, res.attrs);
          // Respond with error or the newly-created record.
          cb(null, [res.attrs]);
        }
      });

      // Respond with error or an array of updated records.
//      cb(null, []);
    },

    /**
     *
     * REQUIRED method if users expect to call Model.destroy()
     *
     * @param  {[type]}   collectionName [description]
     * @param  {[type]}   options        [description]
     * @param  {Function} cb             [description]
     * @return {[type]}                  [description]
     */
    destroy: function (connection, collectionName, options, cb) {
//sails.log.silly("adaptor::destory", collectionName);
//sails.log.silly("options", options);
      var Model = adapter._getModel(collectionName);

      // If you need to access your private data for this collection:
      var collection = _collectionReferences[collectionName];


      // 1. Filter, paginate, and sort records from the datastore.
      //    You should end up w/ an array of objects as a result.
      //    If no matches were found, this will be an empty array.
      //
      // 2. Destroy all result records.
      //
      // (do both in a single query if you can-- it's faster)

      // Return an error, otherwise it's declared a success.
      if ('where' in options) {
        var values = options.where;
        var current = Model.destroy(values, function (err, res) {
          if (err) {
            //sails.log.error('Error destory data' + __filename, err);
            cb(err);
          }
          else {
//                    console.log('add model data',res.attrs);
            // Respond with error or the newly-created record.
            cb();
          }
        });
      }
      else
        cb();
    },



    /*
     **********************************************
     * Optional overrides
     **********************************************

     // Optional override of built-in batch create logic for increased efficiency
     // (since most databases include optimizations for pooled queries, at least intra-connection)
     // otherwise, Waterline core uses create()
     createEach: function (collectionName, arrayOfObjects, cb) { cb(); },

     // Optional override of built-in findOrCreate logic for increased efficiency
     // (since most databases include optimizations for pooled queries, at least intra-connection)
     // otherwise, uses find() and create()
     findOrCreate: function (collectionName, arrayOfAttributeNamesWeCareAbout, newAttributesObj, cb) { cb(); },
     */


    /*
     **********************************************
     * Custom methods
     **********************************************

     ////////////////////////////////////////////////////////////////////////////////////////////////////
     //
     // > NOTE:  There are a few gotchas here you should be aware of.
     //
     //    + The collectionName argument is always prepended as the first argument.
     //      This is so you can know which model is requesting the adapter.
     //
     //    + All adapter functions are asynchronous, even the completely custom ones,
     //      and they must always include a callback as the final argument.
     //      The first argument of callbacks is always an error object.
     //      For core CRUD methods, Waterline will add support for .done()/promise usage.
     //
     //    + The function signature for all CUSTOM adapter methods below must be:
     //      `function (collectionName, options, cb) { ... }`
     //
     ////////////////////////////////////////////////////////////////////////////////////////////////////


     // Custom methods defined here will be available on all models
     // which are hooked up to this adapter:
     //
     // e.g.:
     //
     foo: function (collectionName, options, cb) {
     return cb(null,"ok");
     },
     bar: function (collectionName, options, cb) {
     if (!options.jello) return cb("Failure!");
     else return cb();
     }

     // So if you have three models:
     // Tiger, Sparrow, and User
     // 2 of which (Tiger and Sparrow) implement this custom adapter,
     // then you'll be able to access:
     //
     // Tiger.foo(...)
     // Tiger.bar(...)
     // Sparrow.foo(...)
     // Sparrow.bar(...)


     // Example success usage:
     //
     // (notice how the first argument goes away:)
     Tiger.foo({}, function (err, result) {
     if (err) return console.error(err);
     else console.log(result);

     // outputs: ok
     });

     // Example error usage:
     //
     // (notice how the first argument goes away:)
     Sparrow.bar({test: 'yes'}, function (err, result){
     if (err) console.error(err);
     else console.log(result);

     // outputs: Failure!
     })




     */

    /**
     * set column attributes
     * @param schema  vogels::define return value
     * @param name    column name
     * @param attr    columns detail
     * @private
     */
     _setColumnType: function (schema, name, attr, options) {

      options = (typeof options !== 'undefined') ? options : {};

      // Set primary key options
      if (attr.primaryKey === 'hash') {

        _.merge(options, {hashKey: true});
      } else if (attr.primaryKey === 'range') {

        _.merge(options, {rangeKey: true});
      } else if (attr.index === 'secondary') {

        _.merge(options, {secondaryIndex: true});
      }

      // set columns
//          console.log("name:", name);
//          console.log("attr:", attr);
      var type = (_.isString(attr)) ? attr : attr.type;

      switch (type) {
        case "date":
        case "time":
        case "datetime":
//                  console.log("Set Date:", name);
          schema.Date(name, options);
          break;

        case "integer":
        case "float":
//                  console.log("Set Number:", name);
          schema.Number(name, options);
          break;

        case "boolean":
//                  console.log("Set Boolean:", name);
          schema.Boolean(name, options);
          break;

        case "array":  // not support
          schema.StringSet(name, options);
          break;

//              case "json":
//              case "string":
//              case "binary":
        case "string":

          if (attr.autoIncrement) {

            schema.UUID(name, options);
          } else {

            schema.String(name, options);
          }
          break;

        default:
//                  console.log("Set String", name);
          schema.String(name, options);
          break;
      }
    }

    /**
     * From Object to Array
     * @param results response data
     * @returns {Array} replaced array
     * @private
     */, _resultFormat: function (results) {
      var items = []

      for (var i in results.Items) {
        items.push(results.Items[i].attrs);
      }

//console.log(items);
      return items;
    }


    /*
     collection.definition;
     { user_id: { primaryKey: true, unique: true, type: 'string' },
     range: { primaryKey: true, unique: true, type: 'integer' },
     title: { type: 'string' },
     chart1: { type: 'json' },
     chart2: { type: 'json' },
     chart3: { type: 'json' },
     createdAt: { type: 'datetime' },
     updatedAt: { type: 'datetime' } },
     */
    /**
     * convert values
     * @param definition
     * @param values
     * @private
     */, _valueEncode: function (definition, values) {
      adapter._valueConvert(definition, values, true);
    }, _valueDecode: function (definition, values) {
      adapter._valueConvert(definition, values, false);
    }, _valueConvert: function (definition, values, encode) {
      for (var key in definition) {
        var type = definition[key].type;

        if (_.has(values, key)) {
          switch (type) {
            case "json":
              if (!encode) values[key] = JSON.parse(values[key]);
              else values[key] = JSON.stringify(values[key]);
              break;
            default :
              break;
          }
        }
      }
    }
  };


  // Expose adapter definition
  return adapter;

})();

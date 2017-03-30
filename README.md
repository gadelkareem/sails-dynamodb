# sails-dynamodb

A [Waterline](https://github.com/balderdashy/waterline) adapter for DynamoDB. May be used in a [Sails](https://github.com/balderdashy/sails) app or anything using Waterline for the ORM.


> _**Note:** This adapter support the Sails.js v0.10.x. check 0.9 branch if you use before v0.10

## Install

Install is through NPM.

```bash
$ sails new project && cd project
$ npm install sails-dynamodb --save
```
Add your amazon keys to your adapter config


## Configuration

The following config options are available along with their default values:

config/connection.js
```javascript
module.exports.adapters = {

  // If you leave the adapter config unspecified 
  // in a model definition, 'default' will be used.
  localDiskDb: {
    adapter: 'sails-disk'
  },
  
  dynamoDb: {
    adapter: "sails-dynamodb",
    accessKeyId: process.env.DYNAMO_ACCESS_KEY_ID,
    secretAccessKey: process.env.DYNAMO_SECRET_ACCESS_KEY,
    region: "us-west-1",
    endPoint: "http://localhost:8000", // Optional: add for DynamoDB local
  },
  
};
```

config/models.js
```javascript
module.exports.adapters = {

  // If you leave the adapter config unspecified 
  // in a model definition, 'default' will be used.
  connection: 'dynamoDb'
  
};
```

## Find
Support for where is added as following:
```
  ?where={"name":{"null":true}}
  ?where={"name":{"notNull":true}}
  ?where={"name":{"equals":"firstName lastName"}}
  ?where={"name":{"ne":"firstName lastName"}}
  ?where={"name":{"lte":"firstName lastName"}}
  ?where={"name":{"lt":"firstName lastName"}}
  ?where={"name":{"gte":"firstName lastName"}}
  ?where={"name":{"gt":"firstName lastName"}}
  ?where={"name":{"contains":"firstName lastName"}}
  ?where={"name":{"contains":"firstName lastName"}}
  ?where={"name":{"beginsWith":"firstName"}}
  ?where={"name":{"in":["firstName lastName", "another name"]}}
  ?where={"name":{"between":["firstName, "lastName"]}}
```

### Pagination
__NOTE__: `skip` is not supported!

Support for Pagination is done using DynamoDB's `LastEvaluatedKey` and passing that to `ExclusiveStartKey`.
See: [DynamoDB Documentation](http://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html)

1. First add a limit to current request

```
/user?limit=2
```
    
2. Then get the last primaryKey value and send it as startKey in the next request

```
/user?limit=2&startKey={"PrimaryKey": "2"}
```

For more complex queries, you must provide all the fields that are used for an index of the last object returned. An example not using the blueprint apis below. Assume there is a GSI on email (hash) and loginDate (range).

```
// Looking for recent logins by a specific email address
UserLogins.find({
  where: {
    email: 'someone@like.you'
    loginDate: {"lt": new Date().toISOString()}
  },
  limit: 10
}).exec((err, userLogins) => {
  UserLogins.find({
    where: {
      email: 'someone@like.you'
      loginDate: {"lt": new Date().toISOString()},
      startKey: {
        email: 'someone@like.you',
        loginDate: userLogins[userLogins.length - 1].loginDate
      }
    },
    limit: 10
  }).exec((err, moreUserLogins) => {
    doSomethingWithLogins(userLogins.concat(moreUserLogins));
  });
});
```

See that the startKey is in the `where` block and that it has both fields of the Global Secondary Index.

## Using DynamoDB Indexes
Primary hash/range keys, local secondary indexes, and global secondary indexes are currently supported by this adapter, but their usage is always inferred from query conditions–`Model.find` will attempt to use the most optimal index using the following precedence:
```
Primary hash and range > primary hash and secondary range > global secondary hash and range
> primary hash > global secondary hash > no index/primary
```
If an index is being used and there are additional query conditions, then results are compiled using DynamoDB's result filtering.  If no index can be used for a query, then the adapter will perform a scan on the table for results.

### Adding Indexes
#### Primary hash and primary range
```
UserId: {
  type: 'integer',
  primaryKey: 'hash'
},
GameTitle: {
  type: 'string',
  primaryKey: 'range'
}
```
#### Secondary range (local secondary index)
The index name used for a local secondary index is the name of the field suffixed by "Index".  In this case the index name is `TimeIndex`.
```
Time: {
  type: 'datetime',
  index: 'secondary'
}
```
#### Global secondary index
The index name used for a global secondary index is specified in the `index` property before the type of key (`hash` or `range`).  In this case the index name is `GameTitleIndex`.
```
GameTitle: {
  type: 'string',
  index: 'GameTitleIndex-hash'
},
HighScore: {
  type: 'integer',
  index: 'GameTitleIndex-range'
}
```

#### Fields with multiple indexes
A field can be both the primary and part of a GSI index. Participating in multiple GSI indexes is not currently supported.

```
GameTitle: {
  type: 'string',
  primaryKey: 'hash'
  index: 'GameTitleIndex-hash'
}
```

__Not Supported Yet__:
```
GameTitle: {
  type: 'string',
  primaryKey: 'hash'
  index: ['GameTitleIndex-hash'. 'SomeOtherIndex-hash']
}
```

### Sorting By Indexes
Sorting does not look like how it looks with the normal sails database adapters. You can not sort by an arbitrary field, you must sort by a range field in an index. The index is automatically inferred by what you are querying and you can specify a direction to sort the range fields of the used index. Using the GSI defined above, this will query for descending highscores of Super Mario World:
```
GameScores.find({
  where: {
    GameTitle: "Super Mario World"
  },
  sort: "-1"
})
```

## Update
The `Model.update` method is currently expected to update exactly one item since DynamoDB only offers an [UpdateItem](http://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateItem.html) endpoint.  A complete primary key must be supplied.  Any additional "where" conditions passed to `Model.update` are used to build a conditional expression for the update.  Despite the fact the DynamoDB updates only one item, `Model.update` will always return an array of the (one or zero) updated items upon success.

## Testing

Test are written with mocha. Integration tests are handled by the [waterline-adapter-tests](https://github.com/balderdashy/waterline-adapter-tests) project, which tests adapter methods against the latest Waterline API.

To run tests:

```bash
$ npm test
```


## About Sails.js and Waterline
http://sailsjs.org

Waterline is a new kind of storage and retrieval engine for Sails.js.  It provides a uniform API for accessing stuff from different kinds of databases, protocols, and 3rd party APIs.  That means you write the same code to get users, whether they live in mySQL, LDAP, MongoDB, or Facebook.


![image_squidhome@2x.png](http://i.imgur.com/RIvu9.png) 

## License

The MIT License (MIT)

Copyright (c) 2014 dozo

Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.

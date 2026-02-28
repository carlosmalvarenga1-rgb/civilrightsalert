// =====================================================
// NETLIFY FUNCTION: city-council.js
// Place in: netlify/functions/city-council.js
// 
// Connects to the Legistar Web API (Granicus) to pull
// city council data: members, legislation, meetings, votes
//
// ARIZONA LAUNCH — Verified cities only.
// Each city has been manually confirmed to have active
// data in Legistar before being added here.
// =====================================================

// Node 18+ has built-in fetch — no require needed

const LEGISTAR_BASE = 'https://webapi.legistar.com/v1';

// =====================================================
// CITY DATABASE — ARIZONA ONLY (VERIFIED)
//
// STATUS KEY:
//   verified: true  = We confirmed this city has active
//                     members, legislation, and meetings
//   verified: false = Legistar exists but data is empty
//                     (like Glendale — DO NOT add until
//                      they start populating their portal)
//
// HOW TO ADD A CITY:
//   1. Google "[city name] AZ legistar.com"
//   2. If the page exists, note the subdomain
//      (e.g., phoenix.legistar.com → client = "phoenix")
//   3. Run the verify endpoint: 
//      ?type=verify&client=glendale-az
//      This will test if the city has real data
//   4. If verified, add to CITY_DATABASE with verified: true
//   5. Add to availableCities array in index.html
// =====================================================

const CITY_DATABASE = {
    // ---- VERIFIED & ACTIVE ----
    'Phoenix, AZ': { 
        client: 'phoenix', 
        state: 'AZ', 
        population: 1680992, 
        verified: true,
        verifiedDate: '2026-02-23',
        notes: 'Full data: members, legislation, meetings, votes'
    },
    'Mesa, AZ': { 
        client: 'mesa', 
        state: 'AZ', 
        population: 504258, 
        verified: true,
        verifiedDate: '2026-02-23',
        notes: 'Active portal with agendas and legislation'
    },
    'Apache Junction, AZ': { 
        client: 'apachejunction', 
        state: 'AZ', 
        population: 44632, 
        verified: true,
        verifiedDate: '2026-02-23',
        notes: 'Active meeting records from 2016 to present'
    },
    'Goodyear, AZ': {
        client: 'goodyear',
        state: 'AZ',
        population: 101399,
        verified: true,
        verifiedDate: '2026-02-27',
        notes: 'Legistar portal active'
    },
    'Lake Havasu City, AZ': {
        client: 'lakehavasucity',
        state: 'AZ',
        population: 57761,
        verified: true,
        verifiedDate: '2026-02-27',
        notes: 'Legistar portal active'
    },
    'Maricopa, AZ': {
        client: 'maricopa',
        state: 'AZ',
        population: 58722,
        verified: true,
        verifiedDate: '2026-02-27',
        notes: 'Legistar portal active'
    },
    'Yuma, AZ': {
        client: 'yuma-az',
        state: 'AZ',
        population: 100000,
        verified: true,
        verifiedDate: '2026-02-27',
        notes: 'Legistar portal active'
    },
    
    // ---- KNOWN BUT NOT ACTIVE (DO NOT ENABLE) ----
    // 'Glendale, AZ': { 
    //     client: 'glendale-az', 
    //     state: 'AZ', 
    //     population: 252381, 
    //     verified: false,
    //     verifiedDate: '2026-02-23',
    //     notes: 'Legistar installed but Members(0), Legislation(0), Calendar(0)'
    // },
    
    // ---- NOT ON LEGISTAR ----
    // Tucson — uses tucsonaz.gov (custom site, no API)
    // Chandler — no Legistar portal found
    // Scottsdale — uses Granicus video + custom agenda portal
    // Gilbert — no Legistar portal found
    // Tempe — no Legistar portal found
    // Peoria — no Legistar portal found
    // Surprise — uses CivicPlus
};

// =====================================================
// HELPER FUNCTIONS
// =====================================================

async function legistarFetch(client, endpoint, params = '') {
    const url = `${LEGISTAR_BASE}/${client}/${endpoint}${params ? '?' + params : ''}`;
    console.log(`Fetching: ${url}`);
    
    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        timeout: 15000
    });
    
    if (!response.ok) {
        throw new Error(`Legistar API error: ${response.status} for ${url}`);
    }
    
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        console.log(`JSON parse failed for ${client}/${endpoint}. First 200 chars: ${text.substring(0, 200)}`);
        throw new Error(`Legistar API returned non-JSON for ${client}/${endpoint}`);
    }
}

function getRecentDateFilter(months = 6) {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date.toISOString().split('T')[0];
}

function getFutureDateFilter() {
    return new Date().toISOString().split('T')[0];
}

// =====================================================
// VERIFICATION FUNCTION
// Tests if a city actually has data in Legistar.
// Checks for: active persons, recent matters, events.
// Returns a report card with pass/fail for each.
// =====================================================

async function verifyCity(client) {
    const results = {
        client,
        portal: `https://${client}.legistar.com`,
        checks: {},
        overallPass: false,
        timestamp: new Date().toISOString()
    };
    
    // Check 1: Active persons (council members)
    try {
        const persons = await legistarFetch(client, 'Persons', '$top=10&$filter=PersonActiveFlag eq 1');
        const realPersons = persons.filter(p => 
            p.PersonActiveFlag === 1 && 
            p.PersonFullName && 
            !p.PersonFullName.includes('System') && 
            !p.PersonFullName.includes('View Only')
        );
        results.checks.persons = {
            pass: realPersons.length > 0,
            count: realPersons.length,
            sample: realPersons.slice(0, 3).map(p => p.PersonFullName)
        };
    } catch (e) {
        results.checks.persons = { pass: false, count: 0, error: e.message };
    }
    
    // Check 2: Recent legislation (matters in last 12 months)
    try {
        const recentDate = getRecentDateFilter(12);
        const matters = await legistarFetch(client, 'Matters', 
            `$top=10&$filter=MatterIntroDate ge datetime'${recentDate}'&$orderby=MatterIntroDate desc`
        );
        results.checks.legislation = {
            pass: matters.length > 0,
            count: matters.length,
            sample: matters.slice(0, 3).map(m => m.MatterFile || m.MatterName || 'Untitled')
        };
    } catch (e) {
        results.checks.legislation = { pass: false, count: 0, error: e.message };
    }
    
    // Check 3: Any events (past or future)
    try {
        const events = await legistarFetch(client, 'Events', '$top=10&$orderby=EventDate desc');
        results.checks.events = {
            pass: events.length > 0,
            count: events.length,
            sample: events.slice(0, 3).map(e => `${e.EventBodyName} - ${e.EventDate}`)
        };
    } catch (e) {
        results.checks.events = { pass: false, count: 0, error: e.message };
    }
    
    // Overall: must have at least persons OR legislation with data
    results.overallPass = (
        (results.checks.persons?.pass || false) || 
        (results.checks.legislation?.pass || false)
    );
    
    return results;
}

// =====================================================
// MAIN HANDLER
// =====================================================

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    const params = event.queryStringParameters || {};
    const { city, type } = params;
    
    // ============ LIST AVAILABLE CITIES ============
    if (type === 'cities') {
        const cities = Object.entries(CITY_DATABASE)
            .filter(([_, info]) => info.verified === true)
            .map(([name, info]) => ({
                name,
                state: info.state,
                population: info.population,
                verifiedDate: info.verifiedDate,
                portalUrl: `https://${info.client}.legistar.com`
            }))
            .sort((a, b) => b.population - a.population);
        
        return {
            statusCode: 200, headers,
            body: JSON.stringify({ 
                cities,
                totalCities: cities.length,
                coverage: 'Arizona',
                note: 'Only cities with verified, active Legistar data are listed. More cities added as they are verified.'
            })
        };
    }
    
    // ============ VERIFY A CITY ============
    // Use this to test new cities before adding them.
    // Example: ?type=verify&client=glendale-az
    if (type === 'verify') {
        const testClient = params.client;
        if (!testClient) {
            return { 
                statusCode: 400, headers, 
                body: JSON.stringify({ 
                    error: 'client parameter required for verification',
                    usage: '?type=verify&client=phoenix',
                    tip: 'The client is the subdomain from [client].legistar.com'
                }) 
            };
        }
        
        try {
            const report = await verifyCity(testClient);
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    type: 'verification-report',
                    ...report,
                    recommendation: report.overallPass 
                        ? '✅ This city has active data. Safe to add to CITY_DATABASE.' 
                        : '❌ This city has no usable data. Do NOT add yet.'
                })
            };
        } catch (e) {
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    type: 'verification-report',
                    client: testClient,
                    overallPass: false,
                    error: e.message,
                    recommendation: '❌ Could not connect to this Legistar portal. It may not exist.'
                })
            };
        }
    }
    
    // ============ VALIDATE CITY PARAM ============
    if (!city) {
        return { 
            statusCode: 400, headers, 
            body: JSON.stringify({ 
                error: 'City parameter required.',
                usage: '?city=Phoenix, AZ&type=members',
                availableCities: Object.keys(CITY_DATABASE).filter(c => CITY_DATABASE[c].verified)
            }) 
        };
    }
    
    const cityInfo = CITY_DATABASE[city];
    if (!cityInfo) {
        return { 
            statusCode: 404, headers, 
            body: JSON.stringify({ 
                error: `"${city}" is not available yet.`,
                availableCities: Object.keys(CITY_DATABASE).filter(c => CITY_DATABASE[c].verified),
                tip: 'We are expanding coverage across Arizona. Check back soon.'
            }) 
        };
    }
    
    if (!cityInfo.verified) {
        return { 
            statusCode: 404, headers, 
            body: JSON.stringify({ 
                error: `"${city}" has a Legistar portal but no active data yet.`,
                portal: `https://${cityInfo.client}.legistar.com`,
                tip: 'This city has installed Legistar but has not populated it with data. We monitor this and will enable it when data becomes available.'
            }) 
        };
    }
    
    const { client } = cityInfo;
    
    try {
        // ============ COUNCIL MEMBERS ============
        if (type === 'persons' || type === 'members') {
            // STRATEGY: Use OfficeRecords + Bodies to find ELECTED officials only.
            // This prevents showing 252 city staff when citizens want the 7 council members.
            
            // Step 1: Get all bodies to identify council/board bodies
            let bodies = [];
            try {
                bodies = await legistarFetch(client, 'Bodies');
            } catch (e) {
                console.log('Bodies fetch failed for', client);
            }
            
            // Find council-type body IDs — prioritize the main governing body
            // First look for the primary council body specifically
            const primaryKeywords = ['city council', 'town council', 'mayor and council', 'mayor & council', 'board of supervisors', 'common council'];
            const primaryBodies = bodies.filter(b => {
                const name = (b.BodyName || '').toLowerCase();
                return primaryKeywords.some(kw => name.includes(kw)) && b.BodyActiveFlag === 1;
            });
            
            // If we found primary council bodies, use those. Otherwise fall back to broader search.
            let councilBodies;
            if (primaryBodies.length > 0) {
                councilBodies = primaryBodies;
            } else {
                // Broader fallback — but exclude advisory boards, commissions, committees
                const broadKeywords = ['council', 'mayor', 'aldermen'];
                const excludeKeywords = ['advisory', 'committee', 'commission', 'subcommittee', 'task force', 'authority', 'board of adjustment', 'planning', 'zoning'];
                councilBodies = bodies.filter(b => {
                    const name = (b.BodyName || '').toLowerCase();
                    const matchesBroad = broadKeywords.some(kw => name.includes(kw));
                    const isExcluded = excludeKeywords.some(kw => name.includes(kw));
                    return matchesBroad && !isExcluded && b.BodyActiveFlag === 1;
                });
            }
            
            const councilBodyIds = councilBodies.map(b => b.BodyId);
            console.log(`Found ${councilBodyIds.length} council bodies for ${client}:`, councilBodies.map(b => b.BodyName));
            
            // Step 2: Get office records — these link persons to their elected/appointed positions
            let officeRecords = [];
            try {
                officeRecords = await legistarFetch(client, 'OfficeRecords', '$orderby=OfficeRecordTitle');
            } catch (e) {
                console.log('Office records not available for', client);
            }
            
            // Filter to active office records in council bodies
            const now = new Date();
            const activeCouncilOffices = officeRecords.filter(or => {
                // Must be in a council body (or if no bodies found, keep all)
                const inCouncilBody = councilBodyIds.length === 0 || councilBodyIds.includes(or.OfficeRecordBodyId);
                // Must be currently active (no end date, or end date in future)
                const isActive = !or.OfficeRecordEndDate || new Date(or.OfficeRecordEndDate) > now;
                return inCouncilBody && isActive;
            });
            
            // Get unique person IDs from active council offices
            const councilPersonIds = [...new Set(activeCouncilOffices.map(or => or.OfficeRecordPersonId))];
            
            console.log(`Found ${councilPersonIds.length} council members for ${client}`);
            
            // Step 3: Fetch persons (use broad fetch since we'll filter by ID)
            let persons = [];
            try {
                persons = await legistarFetch(client, 'Persons', '$filter=PersonActiveFlag eq 1&$orderby=PersonLastName');
            } catch (e) {
                console.log('Filtered persons query failed:', e.message);
            }
            
            if (!persons || persons.length === 0) {
                try {
                    persons = await legistarFetch(client, 'Persons', '$orderby=PersonLastName&$top=500');
                } catch (e2) {
                    console.log('Unfiltered persons query failed:', e2.message);
                }
            }
            
            if (!persons || persons.length === 0) {
                try {
                    persons = await legistarFetch(client, 'Persons');
                } catch (e3) {
                    persons = [];
                }
            }
            
            // Step 4: Filter to only council members
            let councilMembers;
            if (councilPersonIds.length > 0) {
                // We found council offices — filter strictly
                councilMembers = persons.filter(p => councilPersonIds.includes(p.PersonId));
            } else {
                // No office records or bodies — fall back to all active persons
                // but filter out obvious system/staff accounts
                const excludeNames = ['system', 'monitor', 'view only', 'test', 'admin', 'clerk', 'secretary', 'attorney', 'manager', 'director', 'coordinator', 'analyst', 'assistant', 'staff'];
                councilMembers = persons
                    .filter(p => p.PersonActiveFlag === 1)
                    .filter(p => {
                        const name = (p.PersonFullName || '').toLowerCase();
                        return !excludeNames.some(ex => name.includes(ex));
                    });
            }
            
            // Step 5: Enrich with office record details
            const enrichedMembers = councilMembers.map(p => {
                const offices = activeCouncilOffices.filter(or => or.OfficeRecordPersonId === p.PersonId);
                const primaryOffice = offices[0];
                return {
                    id: p.PersonId,
                    firstName: p.PersonFirstName,
                    lastName: p.PersonLastName,
                    fullName: p.PersonFullName,
                    email: p.PersonEmail || null,
                    phone: p.PersonPhone || null,
                    website: p.PersonWWW || null,
                    address: [p.PersonAddress1, p.PersonCity1, p.PersonState1, p.PersonZip1].filter(Boolean).join(', ') || null,
                    title: primaryOffice ? primaryOffice.OfficeRecordTitle : null,
                    bodyName: primaryOffice ? primaryOffice.OfficeRecordBodyName : null,
                    startDate: primaryOffice ? primaryOffice.OfficeRecordStartDate : null,
                    endDate: primaryOffice ? primaryOffice.OfficeRecordEndDate : null,
                    active: true
                };
            });
            
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    city, type: 'members',
                    members: enrichedMembers,
                    totalMembers: enrichedMembers.length,
                    councilBodiesFound: councilBodyIds.length,
                    source: `https://${client}.legistar.com`
                })
            };
        }
        
        // ============ RECENT LEGISLATION ============
        if (type === 'matters' || type === 'legislation') {
            const recentDate = getRecentDateFilter(6);
            
            let allMatters = [];
            
            // Try 1: Filter by intro date (most cities)
            try {
                allMatters = await legistarFetch(client, 'Matters', 
                    `$filter=MatterIntroDate ge datetime'${recentDate}'&$orderby=MatterIntroDate desc&$top=50`
                );
            } catch (e) {
                console.log('Filtered matters query failed:', e.message);
            }
            
            // Try 2: If empty, try without date filter, ordered by last modified
            if (!allMatters || allMatters.length === 0) {
                try {
                    allMatters = await legistarFetch(client, 'Matters', '$orderby=MatterLastModifiedUtc desc&$top=50');
                } catch (e) {
                    console.log('LastModified matters query failed:', e.message);
                }
            }
            
            // Try 3: Last resort - just get matters with no filters
            if (!allMatters || allMatters.length === 0) {
                try {
                    allMatters = await legistarFetch(client, 'Matters', '$top=50');
                } catch (e) {
                    console.log('Unfiltered matters query also failed:', e.message);
                    allMatters = [];
                }
            }
            
            const legislation = allMatters.map(m => ({
                id: m.MatterId,
                file: m.MatterFile || m.MatterId.toString(),
                name: m.MatterName,
                title: m.MatterTitle || m.MatterName,
                type: m.MatterTypeName,
                status: m.MatterStatusName,
                introduced: m.MatterIntroDate,
                agendaDate: m.MatterAgendaDate,
                passedDate: m.MatterPassedDate,
                enactmentDate: m.MatterEnactmentDate,
                enactmentNumber: m.MatterEnactmentNumber,
                bodyName: m.MatterBodyName,
                sponsor: m.MatterSponsorName || null,
                lastModified: m.MatterLastModifiedUtc,
                url: `https://${client}.legistar.com/LegislationDetail.aspx?ID=${m.MatterId}&GUID=${m.MatterGuid}`
            }));
            
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    city, type: 'legislation',
                    legislation,
                    totalItems: legislation.length,
                    dateRange: `Last 6 months (since ${recentDate})`,
                    source: `https://${client}.legistar.com`
                })
            };
        }
        
        // ============ UPCOMING MEETINGS ============
        if (type === 'events' || type === 'meetings') {
            const futureDate = getFutureDateFilter();
            
            let events = [];
            
            // Try 1: Future events only
            try {
                events = await legistarFetch(client, 'Events',
                    `$filter=EventDate ge datetime'${futureDate}'&$orderby=EventDate&$top=20`
                );
            } catch (e) {
                console.log('Filtered events query failed:', e.message);
            }
            
            // Try 2: If empty, recent events ordered by date desc
            if (!events || events.length === 0) {
                console.log('Filtered events empty for', client, '— trying ordered desc');
                try {
                    events = await legistarFetch(client, 'Events', '$orderby=EventDate desc&$top=20');
                } catch (e) {
                    console.log('Ordered events query failed:', e.message);
                }
            }
            
            // Try 3: If still empty, just get events
            if (!events || events.length === 0) {
                console.log('Ordered events empty for', client, '— trying bare endpoint');
                try {
                    events = await legistarFetch(client, 'Events', '$top=20');
                } catch (e) {
                    console.log('Bare events query also failed:', e.message);
                    events = [];
                }
            }
            
            const meetings = events.map(e => ({
                id: e.EventId,
                date: e.EventDate,
                time: e.EventTime,
                bodyName: e.EventBodyName,
                location: e.EventLocation,
                agendaStatus: e.EventAgendaStatusName,
                minutesStatus: e.EventMinutesStatusName,
                inSiteURL: e.EventInSiteURL,
                agendaURL: e.EventAgendaFile,
                minutesURL: e.EventMinutesFile,
                videoURL: e.EventVideoPath || null
            }));
            
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    city, type: 'meetings',
                    meetings,
                    totalMeetings: meetings.length,
                    source: `https://${client}.legistar.com`
                })
            };
        }
        
        // ============ PERSON VOTE HISTORY ============
        if (type === 'votes') {
            const personId = params.personId;
            if (!personId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'personId parameter required' }) };
            }
            
            const votes = await legistarFetch(client, `Persons/${personId}/Votes`, '$top=200&$orderby=VoteLastModifiedUtc desc');
            
            const voteHistory = votes.map(v => ({
                id: v.VoteId,
                personName: v.VotePersonName,
                value: v.VoteValueId,
                valueName: v.VoteValueName,
                result: v.VoteResult,
                eventItemId: v.VoteEventItemId,
                lastModified: v.VoteLastModifiedUtc
            }));
            
            // Calculate summary stats
            const summary = {
                total: voteHistory.length,
                yes: voteHistory.filter(v => v.valueName && (v.valueName.toLowerCase().includes('aye') || v.valueName.toLowerCase().includes('yes') || v.valueName.toLowerCase().includes('affirmative'))).length,
                no: voteHistory.filter(v => v.valueName && (v.valueName.toLowerCase().includes('nay') || v.valueName.toLowerCase().includes('no'))).length,
                absent: voteHistory.filter(v => v.valueName && (v.valueName.toLowerCase().includes('absent') || v.valueName.toLowerCase().includes('excused'))).length,
                abstain: voteHistory.filter(v => v.valueName && (v.valueName.toLowerCase().includes('abstain') || v.valueName.toLowerCase().includes('present'))).length
            };
            
            if (summary.total > 0) {
                summary.attendanceRate = Math.round(((summary.total - summary.absent) / summary.total) * 100);
            }
            
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    city, type: 'votes',
                    personId,
                    summary,
                    votes: voteHistory,
                    totalVotes: voteHistory.length,
                    source: `https://${client}.legistar.com`
                })
            };
        }
        
        // ============ MATTER DETAIL ============
        if (type === 'matter-detail') {
            const matterId = params.matterId;
            if (!matterId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'matterId parameter required' }) };
            }
            
            const [matter, sponsors, histories] = await Promise.all([
                legistarFetch(client, `Matters/${matterId}`),
                legistarFetch(client, `Matters/${matterId}/Sponsors`).catch(() => []),
                legistarFetch(client, `Matters/${matterId}/Histories`).catch(() => [])
            ]);
            
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    city, type: 'matter-detail',
                    matter: {
                        id: matter.MatterId,
                        file: matter.MatterFile,
                        name: matter.MatterName,
                        title: matter.MatterTitle,
                        type: matter.MatterTypeName,
                        status: matter.MatterStatusName,
                        introduced: matter.MatterIntroDate,
                        passedDate: matter.MatterPassedDate,
                        bodyName: matter.MatterBodyName,
                        text: matter.MatterText || null,
                        url: `https://${client}.legistar.com/LegislationDetail.aspx?ID=${matter.MatterId}&GUID=${matter.MatterGuid}`
                    },
                    sponsors: sponsors.map(s => ({
                        id: s.MatterSponsorNameId,
                        name: s.MatterSponsorName,
                        sequence: s.MatterSponsorSequence
                    })),
                    history: histories.map(h => ({
                        id: h.MatterHistoryId,
                        date: h.MatterHistoryActionDate,
                        action: h.MatterHistoryActionName,
                        body: h.MatterHistoryActionBodyName,
                        description: h.MatterHistoryActionText,
                        passed: h.MatterHistoryPassedFlag,
                        tally: h.MatterHistoryTally
                    })),
                    source: `https://${client}.legistar.com`
                })
            };
        }
        
        // ============ AGENDA ITEMS ============
        if (type === 'agenda') {
            const eventId = params.eventId;
            if (!eventId) {
                return { statusCode: 400, headers, body: JSON.stringify({ error: 'eventId parameter required' }) };
            }
            
            const items = await legistarFetch(client, `Events/${eventId}/EventItems`, 'AgendaNote=1&MinutesNote=1');
            
            const agendaItems = items.map(item => ({
                id: item.EventItemId,
                title: item.EventItemTitle,
                matterId: item.EventItemMatterId,
                matterFile: item.EventItemMatterFile,
                matterName: item.EventItemMatterName,
                matterType: item.EventItemMatterType,
                matterStatus: item.EventItemMatterStatus,
                actionName: item.EventItemActionName,
                actionText: item.EventItemActionText,
                passedFlag: item.EventItemPassedFlag,
                tally: item.EventItemTally,
                agendaNote: item.EventItemAgendaNote,
                minutesNote: item.EventItemMinutesNote,
                rollCallFlag: item.EventItemRollCallFlag
            }));
            
            return {
                statusCode: 200, headers,
                body: JSON.stringify({
                    city, type: 'agenda',
                    eventId,
                    items: agendaItems,
                    totalItems: agendaItems.length,
                    source: `https://${client}.legistar.com`
                })
            };
        }
        
        // ============ INVALID TYPE ============
        return {
            statusCode: 400, headers,
            body: JSON.stringify({ 
                error: 'Invalid type parameter',
                validTypes: ['cities', 'verify', 'members', 'legislation', 'meetings', 'votes', 'matter-detail', 'agenda'],
                usage: {
                    'List verified cities': '?type=cities',
                    'Verify a new city': '?type=verify&client=glendale-az',
                    'Council members': '?city=Phoenix, AZ&type=members',
                    'Recent legislation': '?city=Phoenix, AZ&type=legislation',
                    'Upcoming meetings': '?city=Phoenix, AZ&type=meetings',
                    'Person vote history': '?city=Phoenix, AZ&type=votes&personId=123',
                    'Bill details': '?city=Phoenix, AZ&type=matter-detail&matterId=456',
                    'Meeting agenda': '?city=Phoenix, AZ&type=agenda&eventId=789'
                }
            })
        };
        
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500, headers,
            body: JSON.stringify({ 
                error: 'Failed to fetch city council data',
                message: error.message,
                city,
                source: `https://${client}.legistar.com`,
                tip: 'The Legistar API may be temporarily unavailable. Try again in a moment.'
            })
        };
    }
};
